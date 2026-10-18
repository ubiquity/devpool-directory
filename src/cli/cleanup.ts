#!/usr/bin/env -S node --enable-source-maps
import process from "node:process";
import type { Endpoints } from "@octokit/types";
import { getOctokitRead, getOctokitWrite, getOctokitDelete } from "../github/client";

function parsePartnerUrl(text: string): { owner: string; repo: string; number: number } | null {
  if (!text) return null;
  const t = text.trim().replace("https://www.github.com/", "https://github.com/");
  const m = t.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

function hasPrice(labels: string[]): boolean {
  return (labels || []).some((l) => /^Price:\s*/.test(String(l)));
}

async function main() {
  const owner = process.env.DIRECTORY_OWNER || (process.env.GITHUB_REPOSITORY?.split("/")[0] ?? "");
  const repo = process.env.DIRECTORY_REPO || (process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "");
  if (!owner || !repo) throw new Error("DIRECTORY_OWNER and DIRECTORY_REPO required");
  const target = `${owner}/${repo}`;
  const guard = process.env.WRITE_TARGET_REPO;
  if (guard && guard !== target) throw new Error(`write-blocked: target ${target} != enforced ${guard}`);

  const dry = process.env.DRY_RUN === "true";
  const okRead = getOctokitRead();
  const okWrite = dry ? (null as any) : getOctokitWrite();
  const okDelete = dry ? (null as any) : getOctokitDelete();

  // Read via read client (PAT/anon) to avoid requiring write token for listing
  const dirIssues: Endpoints["GET /repos/{owner}/{repo}/issues"]["response"]["data"] = await okRead.paginate((okRead as any).issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  // Group by partner URL if present; collect invalids
  const byKey = new Map<string, any[]>();
  const invalid: any[] = [];
  for (const it of dirIssues) {
    const key = parsePartnerUrl(it.body || "");
    if (!key) {
      invalid.push(it);
      continue;
    }
    const k = `${key.owner}/${key.repo}#${key.number}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(it);
  }

  let deleted = 0;
  let updated = 0;
  let kept = 0;
  const plan = {
    deletes: [] as number[],
    closes: [] as number[],
    updates: [] as number[],
    invalidDeletes: [] as number[],
  };

  // Helper to hard-delete an issue by node_id (GraphQL), fallback to closing if needed
  async function hardDeleteIssue(nodeId: string, number?: number) {
    if (dry) {
      if (number) plan.deletes.push(number);
      return;
    }
    // Try GraphQL delete with basic backoff on rate limits
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await (okDelete as any).request("POST /graphql", {
          query: "mutation($id:ID!){ deleteIssue(input:{issueId:$id}){ clientMutationId } }",
          variables: { id: nodeId },
        });
        deleted++;
        return;
      } catch (e: any) {
        const status = e?.status ?? e?.response?.status;
        if (status === 403 && attempt < 2) {
          // Respect reset if provided, else small delay
          const reset = Number(e?.response?.headers?.["x-ratelimit-reset"]) || 0;
          const waitMs = reset * 1000 - Date.now();
          const delay = waitMs > 0 && waitMs < 60_000 ? waitMs : 2_000 * (attempt + 1);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        // Fall through to close if delete not permitted/possible
        break;
      }
    }
    if (number && process.env.CLOSE_FALLBACK === "true") {
      try {
        await (okWrite as any).issues.update({ owner, repo, issue_number: number, state: "closed" });
        deleted++;
        return;
      } catch {
        // noop
      }
    }
  }

  // Delete all issues that do not point to a partner issue URL
  for (const it of invalid) {
    if (dry) plan.invalidDeletes.push(it.number);
    await hardDeleteIssue(it.node_id, it.number);
  }

  // Process each partner group: validate partner, enforce priced-only mirror, dedupe and state sync
  for (const [k, list] of byKey) {
    // Keep oldest; others deleted
    list.sort((a, b) => a.number - b.number);
    const keep = list[0];
    const dups = list.slice(1);
    const [pOwner, rest] = k.split("/");
    const [pRepo, numStr] = rest.split("#");
    const pNum = Number(numStr);

    // Fetch partner issue
    let partner: Awaited<ReturnType<typeof okRead.issues.get>>["data"] | null = null;
    try {
      const { data } = await okRead.issues.get({ owner: pOwner, repo: pRepo, issue_number: pNum });
      partner = data;
    } catch {
      // Partner not found -> delete all mirrors in this group
      for (const it of list) {
        await hardDeleteIssue(it.node_id, it.number);
      }
      continue;
    }

    const partnerLabels = (partner.labels || []).map((l: any) => (typeof l === "string" ? l : l.name)).filter(Boolean);
    const priced = hasPrice(partnerLabels);
    if (!priced) {
      // Should not exist in directory: delete all mirrors in this group
      for (const it of list) {
        await hardDeleteIssue(it.node_id, it.number);
      }
      continue;
    }

    // Dedupe: delete all duplicates beyond the oldest
    for (const it of dups) {
      await hardDeleteIssue(it.node_id, it.number);
    }

    // Sync state & labels on the kept issue
    const desiredState: "open" | "closed" = partner.state === "open" ? "open" : "closed";
    const desiredReason: "completed" | "not_planned" | undefined = partner.state === "closed" ? (partner.state_reason === "not_planned" ? "not_planned" : "completed") : undefined;
    try {
      const needsStateUpdate = keep.state !== desiredState;
      const needsLabelUpdate = JSON.stringify(keep.labels?.map((l: any) => (typeof l === "string" ? l : l.name)).sort()) !== JSON.stringify([...partnerLabels].sort());
      if (needsStateUpdate || needsLabelUpdate) {
        if (dry) {
          plan.updates.push(keep.number);
        } else {
          await (okWrite as any).issues.update({
            owner,
            repo,
            issue_number: keep.number,
            state: desiredState,
            state_reason: desiredReason,
            labels: partnerLabels,
            title: partner.title ?? keep.title,
            body: `https://github.com/${pOwner}/${pRepo}/issues/${pNum}`,
          });
          updated++;
        }
      }
      kept++;
    } catch {
      // best-effort; continue
    }
  }

  const out = { deleted, updated, kept, scanned: dirIssues.length, planned: plan, dry };
  console.log(JSON.stringify(out));
}

main().catch((err) => { console.error(err); process.exit(1); });
