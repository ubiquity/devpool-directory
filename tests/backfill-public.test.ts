import test from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main as backfill } from "../src/cli/backfill";

async function fixture(options: { visibility?: unknown; visibilityError?: boolean; publicationError?: boolean }, run: (state: any) => Promise<void>) {
  const cwd = process.cwd();
  const names = ["CONFIG_PATH", "DIRECTORY_OWNER", "DIRECTORY_REPO", "DATA_BRANCH", "DRY_RUN"] as const;
  const previous = names.map((name) => process.env[name]);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "directory-backfill-public-"));
  process.env.CONFIG_PATH = path.join(scratch, "config.json");
  process.env.DIRECTORY_OWNER = "devpool-directory";
  process.env.DIRECTORY_REPO = "devpool-directory";
  process.env.DATA_BRANCH = "__STORAGE__";
  delete process.env.DRY_RUN;
  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ include: ["partner"], exclude: [] }));
  const history = { node_id: "historical-node", title: "Retained history", state: "closed" };
  const saved: Record<string, any> = { "issues-map.json": { "historical-node": history }, "lifetime-map.json": { "historical-node": 25 } };
  const sourceIssues = [
    { number: 1, node_id: "public-closed", html_url: "https://github.com/partner/public/issues/1", title: "Completed public task",
      state: "closed", state_reason: "completed", labels: [{ name: "Price: 150 USD" }], assignees: [],
      created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" },
    { number: 2, node_id: "public-open", html_url: "https://github.com/partner/public/issues/2", title: "Open public task",
      state: "open", labels: [{ name: "Price: 75 USD" }], assignees: [],
      created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" }
  ];
  const fetched: string[] = [];
  const verified: string[] = [];
  const commits: string[] = [];
  let pending: any[] = [];
  const read: any = {
    repos: {
      listForOrg: () => {},
      get: async ({ repo }: any) => {
        verified.push(repo);
        if (repo === "private") return { data: { private: true } };
        if (options.visibilityError) throw Object.assign(new Error("visibility unavailable"), { status: 404 });
        return { data: { private: Object.hasOwn(options, "visibility") ? options.visibility : false } };
      }
    },
    issues: { listForRepo: () => {} },
    paginate: async (method: unknown, args: any) => {
      if (method === read.repos.listForOrg) {
        assert.deepEqual(args, { org: "partner", type: "all", per_page: 100 });
        return [{ name: "public", private: false }, { name: "private", private: true }];
      }
      assert.equal(method, read.issues.listForRepo);
      fetched.push(args.repo);
      assert.equal(args.repo, "public", "private source history must never be fetched");
      assert.deepEqual(args, { owner: "partner", repo: "public", state: "all", per_page: 100 });
      return sourceIssues;
    }
  };
  const write = {
    repos: { getContent: async ({ path: name }: any) => ({ data: { encoding: "base64", content: Buffer.from(JSON.stringify(saved[name])).toString("base64") } }) },
    git: {
      getRef: async () => ({ data: { object: { sha: "previous" } } }),
      getCommit: async () => ({ data: { tree: { sha: "previous-tree" } } }),
      createTree: async ({ tree }: any) => { pending = tree; return { data: { sha: "next-tree" } }; },
      createCommit: async ({ message }: any) => { commits.push(message); return { data: { sha: "next-commit" } }; },
      updateRef: async () => {
        if (options.publicationError) throw new Error("publication unavailable");
        for (const change of pending) saved[change.path] = JSON.parse(change.content);
      }
    }
  } as unknown as Octokit;
  process.chdir(scratch);
  try { await run({ saved, history, fetched, verified, commits, invoke: () => backfill({ read, write }) }); }
  finally {
    process.chdir(cwd);
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test("historical backfill fetches and publishes only verified public sources while retaining prior history", async () => {
  await fixture({}, async ({ invoke, saved, history, fetched, verified, commits }: any) => {
    await invoke();
    assert.deepEqual(fetched, ["public"]);
    assert.deepEqual(verified.sort(), ["private", "public"]);
    assert.deepEqual(saved["issues-map.json"]["historical-node"], history);
    assert.equal(saved["lifetime-map.json"]["historical-node"], 25);
    assert.equal(saved["issues-map.json"]["public-closed"].title, "Completed public task");
    assert.equal(saved["issues-map.json"]["public-open"].url, "https://github.com/partner/public/issues/2");
    assert.equal(saved["lifetime-map.json"]["public-closed"], 150);
    assert.equal(saved["lifetime-map.json"]["public-open"], 0);
    assert.equal(Object.values(saved["issues-map.json"]).some((issue: any) => issue.repo === "private"), false);
    assert.deepEqual(commits, ["seed: backfill issues-map and lifetime-map"]);
  });
});

for (const visibility of [undefined, null, "false"]) {
  test(`historical backfill rejects ambiguous visibility ${String(visibility)} before publication`, async () => {
    await fixture({ visibility }, async ({ invoke, saved, fetched, commits }: any) => {
      const before = structuredClone(saved);
      await assert.rejects(invoke(), /cannot verify public repository/);
      assert.deepEqual(fetched, []);
      assert.deepEqual(commits, []);
      assert.deepEqual(saved, before);
    });
  });
}

test("historical backfill fails a visibility read without fetching or publishing source data", async () => {
  await fixture({ visibilityError: true }, async ({ invoke, saved, fetched, commits }: any) => {
    const before = structuredClone(saved);
    await assert.rejects(invoke(), /visibility unavailable/);
    assert.deepEqual(fetched, []);
    assert.deepEqual(commits, []);
    assert.deepEqual(saved, before);
  });
});

test("a failed historical seed publication leaves the prior maps intact", async () => {
  await fixture({ publicationError: true }, async ({ invoke, saved, fetched }: any) => {
    const before = structuredClone(saved);
    await assert.rejects(invoke(), /publication unavailable/);
    assert.deepEqual(fetched, ["public"]);
    assert.deepEqual(saved, before);
  });
});
