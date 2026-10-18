import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { Octokit } from "@octokit/rest";
import { syncShard } from "../src/mirror/sync";

const environmentKeys = ["USE_GRAPHQL", "MIRRORS_IN_AGGREGATE", "SHARD_CONCURRENCY", "FULL_RESYNC"];
let previousEnvironment: Array<string | undefined>;
beforeEach(() => {
  previousEnvironment = environmentKeys.map((key) => process.env[key]);
  process.env.USE_GRAPHQL = "false";
  process.env.MIRRORS_IN_AGGREGATE = "true";
  process.env.SHARD_CONCURRENCY = "1";
  process.env.FULL_RESYNC = "true";
});
afterEach(() => environmentKeys.forEach((key, i) => {
  const value = previousEnvironment[i];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}));

function reader(failedRead?: "issues" | "prs") {
  const issueRoute = () => {};
  const prRoute = () => {};
  const calls: string[] = [];
  const failure = new Error(`failed ${failedRead} read`);
  const octokit = {
    issues: { listForRepo: issueRoute }, pulls: { list: prRoute },
    paginate: async (route: unknown) => {
      const kind = route === issueRoute ? "issues" : "prs";
      calls.push(kind);
      if (kind === failedRead) throw failure;
      return [];
    },
    users: { getByUsername: async () => {
      calls.push("avatar");
      return { data: { avatar_url: "https://example.test/avatar" } };
    } },
  } as unknown as Octokit;
  return { octokit, failure, calls };
}

for (const failedRead of ["issues", "prs"] as const) {
  test(`${failedRead} failure rejects the shard instead of publishing a success watermark`, async () => {
    const { octokit, failure, calls } = reader(failedRead);
    const prevSyncMeta = { "partner/repo": { lastSyncISO: "2026-10-01T00:00:00Z" } };
    await assert.rejects(syncShard(octokit, {
      repos: ["partner/repo"], directoryOwner: "directory", directoryRepo: "directory", prevSyncMeta,
    }), (error) => error === failure);
    assert.deepEqual(prevSyncMeta, { "partner/repo": { lastSyncISO: "2026-10-01T00:00:00Z" } });
    assert.ok(!calls.includes("avatar"), "failed shards must not finish successfully");
    if (failedRead === "issues") assert.deepEqual(calls, ["issues"]);
  });
}

test("a successful shard advances metadata only after both reads succeed", async () => {
  const { octokit, calls } = reader();
  const before = new Date().toISOString();
  const result = await syncShard(octokit, {
    repos: ["partner/repo"], directoryOwner: "directory", directoryRepo: "directory",
  });
  assert.deepEqual(calls, ["issues", "prs", "avatar"]);
  assert.ok(result.syncMeta["partner/repo"].lastSyncISO >= before);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.prs, []);
});
