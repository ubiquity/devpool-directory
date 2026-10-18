#!/usr/bin/env -S node --enable-source-maps
import { getOctokitRead, getOctokitWrite } from "../github/client";
import { syncShard } from "../mirror/sync";
import { writeJson } from "../artifacts/write";
import fs from "node:fs";
import process from "node:process";
import type { Octokit } from "@octokit/rest";

export async function main(clients?: { write: Octokit; read: Octokit }) {
  const shardArgIndex = process.argv.indexOf("--shard");
  let shardId = 0;
  if (shardArgIndex !== -1) {
    const shardValue = process.argv[shardArgIndex + 1];
    if (shardValue === undefined || shardValue.startsWith("--") || isNaN(Number(shardValue))) {
      console.error("Error: --shard must be followed by a valid number.");
      process.exit(1);
    }
    shardId = Number(shardValue);
  }
  const outDir = `out`;

  const directoryOwner = process.env.DIRECTORY_OWNER ?? "";
  const directoryRepo = process.env.DIRECTORY_REPO ?? "";

  // Load plan.json (downloaded from artifacts in workflow)
  let repos: string[] = [];
  try {
    const plan = JSON.parse(fs.readFileSync("plan.json", "utf8"));
    const entry = (plan?.matrix?.include ?? []).find((e: any) => e.shard_id === shardId);
    if (entry?.repos) repos = entry.repos as string[];
  } catch {}

  const octokitWrite = clients?.write ?? getOctokitWrite();
  const octokitRead = clients?.read ?? getOctokitRead();
  // Optional inputs provided by plan job
  const indexPath = "index.json";
  const lastRunPath = "last-run.json";
  const syncMetaInPath = "sync-metadata.json";

  function safeReadJson<T>(p: string, fallback: T): T {
    try {
      if (!fs.existsSync(p)) return fallback;
      const txt = fs.readFileSync(p, "utf8");
      if (!txt || !txt.trim()) return fallback;
      return JSON.parse(txt) as T;
    } catch {
      return fallback;
    }
  }

  const index = safeReadJson<Record<string, { number: number; url: string }>>(indexPath, {});
  const syncMetaIn = safeReadJson<{ perRepo: Record<string, { lastSyncISO?: string }> }>(syncMetaInPath, { perRepo: {} });
  const lastRun = safeReadJson<{ lastRunISO?: string }>(lastRunPath, {});

  // Cold-start guard: if the persistent issues map is absent in the workspace,
  // force a full resync to bootstrap the dataset instead of doing incremental
  // "since" queries that can return nothing and keep artifacts empty.
  // Also allow manual override via FORCE_FULL_RESYNC=true.
  const issuesMapPath = "issues-map.json";
  const shouldForceFullResync = process.env.FORCE_FULL_RESYNC === "true" || !fs.existsSync(issuesMapPath);
  if (shouldForceFullResync) {
    process.env.FULL_RESYNC = "true";
    console.error("[sync-shard] Forcing FULL_RESYNC (missing issues-map.json or override enabled)");
  }

  const res = await syncShard(
    octokitWrite,
    { repos, directoryOwner, directoryRepo, index, prevSyncMeta: syncMetaIn.perRepo, octokitRead, ...(lastRun?.lastRunISO ? { globalSinceISO: lastRun.lastRunISO } : {}) }
  );

  writeJson(outDir, `shard-${shardId}-issues.json`, res.issues);
  writeJson(outDir, `shard-${shardId}-prs.json`, res.prs);
  writeJson(outDir, `shard-${shardId}-mirror-state.json`, res.mirrorState);
  writeJson(outDir, `shard-${shardId}-owners.json`, res.owners);
  writeJson(outDir, `shard-${shardId}-sync-meta.json`, res.syncMeta);
}

if (process.argv[1] && /(?:^|[\\/])sync-shard\.(?:ts|js|cjs|mjs)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
