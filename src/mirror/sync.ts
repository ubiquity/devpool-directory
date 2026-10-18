import type { Octokit } from "@octokit/rest";
import pLimit from "p-limit";
import type { MirrorState, PartnerIssue } from "../artifacts/types";
import { fetchIssuesForRepo, fetchPRsForRepo, fetchOwnersAvatars } from "../fetch";
import { fetchIssuesForRepoGQL, fetchPRsForRepoGQL } from "../fetch-graphql";
import { computeMirrorStateEntry } from "../artifacts/state";
import { reconcileMirror, type IndexMap } from "./reconcile";

export type SyncResult = {
  issues: PartnerIssue[];
  mirrorState: MirrorState;
  prs: any[]; // placeholder
  owners: Array<{ owner: string; type: "User" | "Organization"; avatar_url: string }>;
  twitterDelta: Record<string, string>; // node_id -> tweet_id
  syncMeta: any; // per-repo etags/since metadata
};

export async function syncShard(
  octokitWrite: Octokit,
  opts: {
    repos: string[];
    directoryOwner: string;
    directoryRepo: string;
    index?: IndexMap;
    prevSyncMeta?: Record<string, { lastSyncISO?: string }>;
    octokitRead?: Octokit;
    globalSinceISO?: string; // fallback watermark supplied by plan (latest successful Actions run)
  }
): Promise<SyncResult> {
  const issues: PartnerIssue[] = [];
  const mirrorState: MirrorState = {};
  const prs: any[] = [];
  const ownersSet = new Set<string>();
  const twitterDelta: Record<string, string> = {};
  const syncMeta: Record<string, any> = {};

  const index: IndexMap = opts.index ?? {};
  const dryRun = process.env.DRY_RUN === "true";
  const mirrorsInAggregate = process.env.MIRRORS_IN_AGGREGATE === "true";

  const poolSize = Math.max(1, Number(process.env.SHARD_CONCURRENCY ?? "4"));
  const pool = pLimit(poolSize);

  const okRead = opts.octokitRead ?? octokitWrite;

  // Helper to time-bound async operations to prevent rare hangs
  async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let to: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<T>((_, rej) => {
          to = setTimeout(() => rej(new Error(`timeout: ${label} after ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      if (to) clearTimeout(to);
    }
  }

  const tasks = opts.repos.map((full) =>
    pool(async () => {
      const [owner] = full.split("/");
      ownersSet.add(owner);

      let iss: PartnerIssue[] = [];
      try {
        const fullResync = process.env.FULL_RESYNC === "true";
        let since: string | undefined;
        if (!fullResync) {
          const prev = opts.prevSyncMeta?.[full]?.lastSyncISO;
          if (prev) {
            const fudgeMin = Math.max(0, Number(process.env.SYNC_SINCE_FUDGE_MINUTES ?? "5"));
            const t = new Date(prev).getTime();
            const sinceMs = isFinite(t) ? Math.max(0, t - fudgeMin * 60 * 1000) : Date.now();
            since = new Date(sinceMs).toISOString();
          } else if (opts.globalSinceISO) {
            const fudgeMin = Math.max(0, Number(process.env.SYNC_SINCE_FUDGE_MINUTES ?? "5"));
            const t = new Date(opts.globalSinceISO).getTime();
            const sinceMs = isFinite(t) ? Math.max(0, t - fudgeMin * 60 * 1000) : Date.now();
            since = new Date(sinceMs).toISOString();
          }
        }
        const useGql = process.env.USE_GRAPHQL === "true";
        const repoTimeoutMs = Math.max(30000, Number(process.env.REPO_TIMEOUT_MS ?? "180000"));
        if (useGql) {
          try {
            iss = await withTimeout(fetchIssuesForRepoGQL(okRead, full, since), repoTimeoutMs, `issues GQL ${full}`);
          } catch (gqlErr) {
            console.warn(`[sync] GQL issues fallback to REST for ${full}: ${gqlErr instanceof Error ? gqlErr.message : gqlErr}`);
            iss = await withTimeout(fetchIssuesForRepo(okRead, full, since), repoTimeoutMs, `issues REST ${full}`);
          }
        } else {
          iss = await withTimeout(fetchIssuesForRepo(okRead, full, since), repoTimeoutMs, `issues REST ${full}`);
        }
      } catch (e: any) {
        console.warn(`[sync] fetchIssues failed for ${full}: ${e?.status ?? e?.message ?? e}`);
        throw e;
      }
      issues.push(...iss);

      for (const it of iss) {
        // Skip potential mirror issues to avoid recursion: body exactly a GitHub issue URL
        if (it.body && /^https?:\/\/(www\.)?github\.com\/[^\s]+\/issues\/\d+$/.test(it.body.trim())) {
          continue;
        }
        const hasPrice = it.labels.some((l) => /^Price:\s*/.test(l));
        const isOpen = it.state === "open";
        let dir: { number?: number; url?: string } | null = null;

        // Create/Update mirrors only for open + priced issues (skip here if aggregator handles writes)
        if (!mirrorsInAggregate && isOpen && hasPrice) {
          try {
            const res = await reconcileMirror(
              octokitWrite,
              { owner: opts.directoryOwner, repo: opts.directoryRepo },
              { node_id: it.node_id, title: it.title, html_url: it.url, state: it.state, labels: it.labels },
              index,
              { dryRun }
            );
            dir = res;
            index[it.node_id] = { number: res.number!, url: res.url! };
          } catch (e) {
            console.warn(`[sync] mirror create/update failed for ${it.owner}/${it.repo}#${it.number}: ${e instanceof Error ? e.message : e}`);
          }
        } else if (!mirrorsInAggregate && !isOpen && index[it.node_id]) {
          // Close existing mirror when partner issue is closed
          try {
            const res = await reconcileMirror(
              octokitWrite,
              { owner: opts.directoryOwner, repo: opts.directoryRepo },
              { node_id: it.node_id, title: it.title, html_url: it.url, state: it.state, labels: it.labels },
              index,
              { dryRun }
            );
            dir = res;
          } catch (e) {
            console.warn(`[sync] mirror close failed for ${it.owner}/${it.repo}#${it.number}: ${e instanceof Error ? e.message : e}`);
          }
        }

        mirrorState[it.node_id] = computeMirrorStateEntry(it, dir, undefined);
      }

      try {
        const useGql = process.env.USE_GRAPHQL === "true";
        const repoTimeoutMs = Math.max(30000, Number(process.env.REPO_TIMEOUT_MS ?? "180000"));
        const rawPrs = useGql
          ? await (async () => {
              try { return await withTimeout(fetchPRsForRepoGQL(okRead, full, undefined), repoTimeoutMs, `prs GQL ${full}`); }
              catch { return await withTimeout(fetchPRsForRepo(okRead, full), repoTimeoutMs, `prs REST ${full}`); }
            })()
          : await withTimeout(fetchPRsForRepo(okRead, full), repoTimeoutMs, `prs REST ${full}`);
        prs.push(...rawPrs);
      } catch (e: any) {
        console.warn(`[sync] fetchPRs failed for ${full}: ${e?.status ?? e?.message ?? e}`);
        throw e;
      }

      syncMeta[full] = { lastSyncISO: new Date().toISOString() };
    })
  );

  await Promise.all(tasks);

  const owners = await fetchOwnersAvatars(okRead, ownersSet);

  return { issues, mirrorState, prs, owners, twitterDelta, syncMeta };
}
