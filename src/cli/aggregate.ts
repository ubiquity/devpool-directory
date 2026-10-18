#!/usr/bin/env -S node --enable-source-maps
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { mergeIssues, mergePRs, computeStatistics } from "../artifacts/merge";
import { writeJson } from "../artifacts/write";
import { Octokit } from "@octokit/rest";
import { ensureBranch, commitChanges } from "../storage/git";
import { computeMirrorStateEntry } from "../artifacts/state";
import { reconcileMirror } from "../mirror/reconcile";
import { getOctokitDelete, getOctokitRead } from "../github/client";
import { loadArtifact } from "../storage/load";
import { recoverMirrorState, applyRecoveredClosures } from "../mirror/recover";

async function main() {
  const shardsDir = path.join(process.cwd(), "shards");
  const shardDirs = fs.existsSync(shardsDir) ? fs.readdirSync(shardsDir) : [];

  const issueChunks: any[] = [];
  const prChunks: any[] = [];
  const mirrorChunks: any[] = [];
  const ownerChunks: any[] = [];
  const syncChunks: any[] = [];
  const twitterDeltas: any[] = [];
  let tweetsCreated = 0;
  let tweetsDeleted = 0;
  const shardIdSet = new Set<number>();

  for (const d of shardDirs) {
    const dir = path.join(shardsDir, d);
    if (!fs.lstatSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith("-issues.json")) issueChunks.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (f.endsWith("-prs.json")) prChunks.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (f.endsWith("-mirror-state.json")) mirrorChunks.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (f.endsWith("-owners.json")) ownerChunks.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (f.endsWith("-sync-meta.json")) syncChunks.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (f.endsWith("-twitter-delta.json")) twitterDeltas.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      const m = f.match(/^shard-(\d+)-/);
      if (m) shardIdSet.add(Number(m[1]));
    }
  }

  const issues = mergeIssues(issueChunks);
  const prs = mergePRs(prChunks);
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const owner = process.env.DIRECTORY_OWNER ?? "";
  const repo = process.env.DIRECTORY_REPO ?? "";
  const branch = process.env.DATA_BRANCH ?? "__STORAGE__";
  const enforced = process.env.WRITE_TARGET_REPO;
  const target = `${owner}/${repo}`;
  if (enforced && enforced !== target) {
    throw new Error(`write-blocked: target ${target} != enforced ${enforced}`);
  }

  const [ownersPrev, issuesPrev, mirrorPrev, indexPrev, twitterPrev, lifetimePrev] = await Promise.all([
    loadArtifact<any[]>(octokit, owner, repo, "owners-avatars.json", branch),
    loadArtifact<Record<string, any>>(octokit, owner, repo, "issues-map.json", branch),
    loadArtifact<Record<string, any>>(octokit, owner, repo, "mirror-state.json", branch),
    loadArtifact<Record<string, { number: number; url: string }>>(octokit, owner, repo, "index.json", branch),
    loadArtifact<Record<string, string>>(octokit, owner, repo, "twitter-map.json", branch),
    loadArtifact<Record<string, number>>(octokit, owner, repo, "lifetime-map.json", branch)
  ]);
  if (ownersPrev && !Array.isArray(ownersPrev)) throw new Error("invalid owners artifact");
  for (const record of [issuesPrev, mirrorPrev, indexPrev, twitterPrev, lifetimePrev]) {
    if (Array.isArray(record)) throw new Error("invalid record artifact");
  }
  const ownersMap: Record<string, { owner: string; type: "User" | "Organization"; avatar_url: string }> = {};
  let duplicatesDeleted = 0;
  for (const o of ownersPrev ?? []) ownersMap[o.owner] = o;
  for (const chunk of ownerChunks) for (const o of chunk) ownersMap[o.owner] = o;
  const owners = Object.values(ownersMap).sort((a, b) => a.owner.localeCompare(b.owner));

  const syncMeta = { perRepo: {} as Record<string, any> };
  for (const ch of syncChunks) Object.assign(syncMeta.perRepo, ch?.perRepo ?? ch);

  // Load and update issues map (persistent), then compute open+priced from the full map
  const issuesMap: Record<string, any> = { ...(issuesPrev ?? {}) };
  for (const it of issues) issuesMap[it.node_id] = it;
  const directory = { owner, repo };
  const dry = process.env.DRY_RUN === "true";
  const recovered = await recoverMirrorState(getOctokitRead(), directory, issuesMap, indexPrev ?? {}, mirrorPrev ?? {}, new Set(issues.map((issue) => issue.node_id)));
  for (const node of recovered.cancelledNodeIds) delete issuesMap[node];
  const allIssues: any[] = Object.values(issuesMap);
  const issuesOpenPricedFromMap = allIssues.filter((i) => i.state === "open" && (i.labels || []).some((l: string) => /^Price:\s*/.test(String(l))));
  // Open issues without an explicit Price label (proposals)
  const issuesOpenUnpricedFromMap = allIssues.filter(
    (i) => i.state === "open" && !((i.labels || []).some((l: string) => /^Price:\s*/.test(String(l))))
  );

  const mirrorForStats: Record<string, any> = {};
  for (const it of allIssues) mirrorForStats[it.node_id] = computeMirrorStateEntry(it, null, undefined);
  const issuesOpenPriced = issuesOpenPricedFromMap;
  const stats = computeStatistics(issuesOpenPricedFromMap, mirrorForStats);
  // Compute additional aggregate helpers for UI rendering
  const closedAllCount = allIssues.filter((i) => i.state === "closed").length;
  const projectsOpenPriced = new Set(issuesOpenPricedFromMap.map((i) => `${i.owner}/${i.repo}`)).size;
  const projectsAny = new Set(allIssues.map((i) => `${i.owner}/${i.repo}`)).size;
  const projectsClosedAny = new Set(allIssues.filter((i) => i.state === "closed").map((i) => `${i.owner}/${i.repo}`)).size;
  (stats as any).lifetime = { tasksCompletedAll: closedAllCount };
  (stats as any).projects = {
    openPriced: projectsOpenPriced,
    any: projectsAny,
    closedAny: projectsClosedAny
  };
  // Convenience breakdown for open+priced
  (stats as any).breakdown = {
    openPricedUSD: (stats as any).rewards.total,
    openPricedCount: issuesOpenPricedFromMap.length,
    availableUSD: (stats as any).rewards.notAssigned,
    availableCount: (stats as any).tasks.notAssigned,
    ongoingUSD: (stats as any).rewards.assigned,
    ongoingCount: (stats as any).tasks.assigned
  };

  // Keep durable identities even when an incremental batch omits their source.
  const indexBuilt = recovered.index;
  const mirrorStateNew = recovered.state;
  const okDelete = getOctokitDelete();
  await applyRecoveredClosures(octokit, directory, recovered.closures, dry);
  const recoveredClosed = new Set(recovered.closures.map((closure) => closure.nodeId));
  console.error(`[aggregate] skipping ${recovered.unchangedClosed.size} unchanged closed mirrors`);
  for (const it of allIssues) {
    const isOpen = it.state === "open";
    const hasPrice = (it.labels || []).some((l: string) => /^Price:\s*/.test(String(l)));
    let dirRef: { number?: number; url?: string } | null = indexBuilt[it.node_id] ?? null;
    if (!recoveredClosed.has(it.node_id) && !recovered.unchangedClosed.has(it.node_id)) {
      if (isOpen && hasPrice) {
        dirRef = await reconcileMirror(octokit, directory, { node_id: it.node_id, title: it.title, html_url: it.url, state: it.state, labels: it.labels }, indexBuilt, { dryRun: dry });
        indexBuilt[it.node_id] = { number: dirRef.number!, url: dirRef.url! };
      } else if (!isOpen && indexBuilt[it.node_id]) {
        dirRef = await reconcileMirror(octokit, directory, { node_id: it.node_id, title: it.title, html_url: it.url, state: "closed", labels: it.labels }, indexBuilt, { dryRun: dry });
      } else if (!hasPrice && indexBuilt[it.node_id]) {
        // Unpriced (open or closed): remove any existing mirror to preserve the
        // invariant that the directory mirrors only open + priced partner issues.
        try {
          // Fetch the directory issue to obtain its node_id for hard delete
          const dirIssueNum = indexBuilt[it.node_id].number;
          if (!dry && Number.isFinite(dirIssueNum)) {
            const { data: dirIssue } = await (octokit as any).issues.get({ owner, repo, issue_number: dirIssueNum });
            const nodeId = (dirIssue as any).node_id as string | undefined;
            if (nodeId) {
              try {
                await (okDelete as any).request("POST /graphql", {
                  query: "mutation($id:ID!){ deleteIssue(input:{issueId:$id}){ clientMutationId } }",
                  variables: { id: nodeId },
                });
                // Remove from in-memory index so later iterations do not reference it
                delete indexBuilt[it.node_id];
              } catch {
                // best-effort; do not fallback to close to avoid violating invariants
              }
            }
          } else {
            // Dry run: pretend it's removed from the index
            delete indexBuilt[it.node_id];
          }
        } catch {
          // ignore and continue
        }
      }
    }
    mirrorStateNew[it.node_id] = computeMirrorStateEntry(it, dirRef, undefined);
  }

  // Seed twitter map from existing artifact on data branch, then merge deltas

  const twitterMap: Record<string, string> = { ...(twitterPrev ?? {}) };
  for (const d of twitterDeltas) {
    if (d && typeof d === "object") {
      if (d.creates || d.deletes) {
        const creates = d.creates ?? {};
        const deletes = d.deletes ?? [];
        Object.assign(twitterMap, creates);
        for (const id of deletes) delete twitterMap[id];
        tweetsCreated += Object.keys(creates).length;
        tweetsDeleted += deletes.length;
      } else {
        Object.assign(twitterMap, d);
      }
    }
  }

  // Final safety: hard-delete duplicate mirrors by partner URL (keep the oldest issue number per URL).
  // Targeted search per URL, opt-in via FINAL_DEDUP=true to avoid rate-limit issues by default.
  if (process.env.FINAL_DEDUP === "true") {
    try {
      const candidateUrls = Array.from(new Set(issuesOpenPricedFromMap.map((i) => String(i.url))));
      for (const url of candidateUrls) {
        try {
          const urlWww = url.replace("https://github.com/", "https://www.github.com/");
          const q = `repo:${owner}/${repo} in:body is:issue ${JSON.stringify(url)}`;
          const res = await (octokit as any).search.issuesAndPullRequests({ q, per_page: 50 });
          const items = (res.data.items || []).filter((it: any) => {
            const b = String((it as any).body || "").trim();
            return b === url || b === urlWww;
          });
          if (items.length > 1) {
            const sorted = items.map((it: any) => ({ number: it.number, node_id: it.node_id })).sort((a: any, b: any) => a.number - b.number);
            for (const dup of sorted.slice(1)) {
              try {
                if (dup.node_id) {
                  await (okDelete as any).request("POST /graphql", {
                    query: "mutation($id:ID!){ deleteIssue(input:{issueId:$id}){ clientMutationId } }",
                    variables: { id: dup.node_id },
                  });
                } else {
                  await (octokit as any).issues.update({ owner, repo, issue_number: dup.number, state: "closed" });
                }
                duplicatesDeleted++;
              } catch {}
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Lifetime completed rollup (closed+priced) via persistent map
  // Load prior lifetime map (node_id -> amountUSD), update only changed issues, then sum
  const lifetimeMap: Record<string, number> = { ...(lifetimePrev ?? {}) };
  for (const node of recovered.cancelledNodeIds) lifetimeMap[node] = 0;
  const parsePrice = (labels: string[]): number => {
    const raw = (labels || []).find((l: string) => /^Price:\s*/.test(String(l)));
    if (!raw) return 0;
    const n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };
  for (const it of issues) {
    if (it.state === "closed") {
      lifetimeMap[it.node_id] = parsePrice(it.labels);
    } else {
      // If reopened or price removed, clear
      lifetimeMap[it.node_id] = 0;
    }
  }
  const rewardsCompletedUSD = Object.values(lifetimeMap).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const tasksCompletedPriced = Object.values(lifetimeMap).filter((v) => (Number.isFinite(v) ? v : 0) > 0).length;
  const prevLifetime = (stats as any).lifetime || {};
  (stats as any).lifetime = { ...prevLifetime, rewardsCompletedUSD, tasksCompletedPriced };

  // Write local build outputs for debugging
  const outDir = path.join(process.cwd(), "out-agg");
  writeJson(outDir, "partner-open-issues.json", issuesOpenPricedFromMap);
  writeJson(outDir, "partner-open-proposals.json", issuesOpenUnpricedFromMap);
  writeJson(outDir, "partner-pull-requests.json", prs);
  writeJson(outDir, "owners-avatars.json", owners);
  writeJson(outDir, "mirror-state.json", mirrorStateNew);
  writeJson(outDir, "statistics.json", stats);
  writeJson(outDir, "sync-metadata.json", syncMeta);
  writeJson(outDir, "twitter-map.json", twitterMap);
  writeJson(outDir, "index.json", indexBuilt);
  writeJson(outDir, "issues-map.json", issuesMap);
  writeJson(outDir, "lifetime-map.json", lifetimeMap);

  // Generate a concise README for the data branch (__STORAGE__) to help integrators
  const storageReadme = `# DevPool Directory — Data Branch (__STORAGE__)

This branch is an artifacts-only branch for UIs and services. Files are updated atomically per run.

How to fetch (Contents API):
- GET /repos/{owner}/{repo}/contents/{path}?ref=__STORAGE__
- Use ETag/If-None-Match to avoid re-downloading unchanged files.
- Poll summary.json first; if unchanged, skip other reads.

Primary artifacts:
- partner-open-issues.json — Open + priced partner issues (Price: label).
- partner-open-proposals.json — Open partner issues without Price: ("proposals").
- mirror-state.json — node_id -> mirror linkage + assignment flags.
- index.json — node_id -> { number, url } for directory issues.
- statistics.json — Aggregate counts + lifetime rollups.
- owners-avatars.json — { owner, type, avatar_url }[] for badges.
- partner-pull-requests.json — Partner PRs (state=all).
- twitter-map.json — node_id -> tweetId.
- issues-map.json — Persistent map of all known issues (state=all). Large.
- lifetime-map.json — node_id -> closed priced amount (for totals).
- sync-metadata.json — Per-repo since/etag hints.
- summary.json — Run summary and list of committed files.

Notes:
- Price label standard is "Price:" only. The legacy "Pricing:" prefix is deprecated and treated as unpriced.
- Array order is not guaranteed; sort client-side as needed.
- Identity key is GitHub GraphQL node_id.
`;
  try { fs.writeFileSync(path.join(outDir, "README.md"), storageReadme); } catch {}

  // Build human-friendly summary
  const reposProcessed = Object.keys(syncMeta.perRepo || {}).length;
  const issuesOpen = issues.filter((i) => i.state === "open").length;
  const issuesClosed = issues.filter((i) => i.state === "closed").length;
  const issuesOpenPricedCount = issuesOpenPriced.length;
  const summary = {
    reposProcessed,
    shards: shardIdSet.size,
    issuesOpen,
    issuesOpenPriced: issuesOpenPricedCount,
    issuesOpenUnpriced: issuesOpenUnpricedFromMap.length,
    issuesClosed,
    prs: prs.length,
    mirrors: Object.keys(mirrorStateNew).length,
    owners: owners.length,
    tweetsCreated,
    tweetsDeleted,
    duplicatesDeleted,
    committedFiles: [
      "partner-open-issues.json",
      "partner-open-proposals.json",
      "partner-pull-requests.json",
      "owners-avatars.json",
      "mirror-state.json",
      "statistics.json",
      "sync-metadata.json",
      "twitter-map.json",
      "index.json",
      "summary.json",
      "README.md"
    ]
  };
  writeJson(outDir, "summary.json", summary);

  if (process.env.DRY_RUN === "true") return;

  await ensureBranch(octokit, owner, repo, branch);
  await commitChanges(octokit, owner, repo, branch, "sync: update artifacts", [
    { path: "partner-open-issues.json", content: JSON.stringify(issuesOpenPricedFromMap) },
    { path: "partner-open-proposals.json", content: JSON.stringify(issuesOpenUnpricedFromMap) },
    { path: "partner-pull-requests.json", content: JSON.stringify(prs) },
    { path: "owners-avatars.json", content: JSON.stringify(owners) },
    { path: "mirror-state.json", content: JSON.stringify(mirrorStateNew) },
    { path: "statistics.json", content: JSON.stringify(stats) },
    { path: "sync-metadata.json", content: JSON.stringify(syncMeta) },
    { path: "twitter-map.json", content: JSON.stringify(twitterMap) },
    { path: "index.json", content: JSON.stringify(indexBuilt) },
    { path: "summary.json", content: JSON.stringify(summary) },
    { path: "lifetime-map.json", content: JSON.stringify(lifetimeMap) },
    { path: "issues-map.json", content: JSON.stringify(issuesMap) },
    { path: "README.md", content: storageReadme }
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
