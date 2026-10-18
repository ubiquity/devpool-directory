#!/usr/bin/env -S node --enable-source-maps
import { Octokit } from "@octokit/rest";
import pLimit from "p-limit";
import { loadConfig } from "../config/load.js";
import { discoverRepos } from "../discovery.js";
import { fetchIssuesForRepo } from "../fetch.js";
import { ensureBranch, commitChanges } from "../storage/git.js";
import { loadArtifact } from "../storage/load.js";

async function main() {
  const cfg = loadConfig();
  let repos: string[] = [];
  try {
    repos = await discoverRepos(new Octokit({ auth: process.env.GH_TOKEN || process.env.GITHUB_TOKEN }), cfg);
  } catch (_e) {
    // Fallback to anonymous for public orgs if token is invalid/mis-scoped
    repos = await discoverRepos(new Octokit(), cfg);
  }

  const octokitRead = process.env.GH_TOKEN ? new Octokit({ auth: process.env.GH_TOKEN }) : new Octokit();
  const octokitWrite = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const owner = process.env.DIRECTORY_OWNER ?? "";
  const repo = process.env.DIRECTORY_REPO ?? "";
  const branch = process.env.DATA_BRANCH ?? "__STORAGE__";

  if (!owner || !repo) throw new Error("DIRECTORY_OWNER and DIRECTORY_REPO must be set");

  const issuesMap = await loadArtifact<Record<string, any>>(octokitWrite, owner, repo, "issues-map.json", branch) ?? {};
  const lifetimeMap = await loadArtifact<Record<string, number>>(octokitWrite, owner, repo, "lifetime-map.json", branch) ?? {};

  const limit = pLimit(Math.max(2, Number(process.env.BACKFILL_CONCURRENCY || "6")));
  let totalFetched = 0;

  const parsePrice = (labels: string[]): number => {
    const raw = (labels || []).find((l: string) => /^Price:\s*/.test(String(l)));
    if (!raw) return 0;
    const n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };

  await Promise.all(
    repos.map((full) =>
      limit(async () => {
        const issues = await fetchIssuesForRepo(octokitRead, full, undefined); // full history
        totalFetched += issues.length;
        for (const it of issues) {
          issuesMap[it.node_id] = it;
          lifetimeMap[it.node_id] = it.state === "closed" ? parsePrice(it.labels) : 0;
        }
      })
    )
  );

  const dry = process.env.DRY_RUN === "true";
  if (dry) {
    console.log(`[backfill] DRY_RUN complete: repos=${repos.length} issues=${totalFetched}`);
    return;
  }

  await ensureBranch(octokitWrite, owner, repo, branch);
  await commitChanges(
    octokitWrite,
    owner,
    repo,
    branch,
    "seed: backfill issues-map and lifetime-map",
    [
      { path: "issues-map.json", content: JSON.stringify(issuesMap) },
      { path: "lifetime-map.json", content: JSON.stringify(lifetimeMap) }
    ]
  );

  console.log(`[backfill] Completed: repos=${repos.length} issues=${totalFetched}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
