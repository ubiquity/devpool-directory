import test from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import type { PartnerIssue } from "../src/artifacts/types";
import { recoverMirrorState, applyRecoveredClosures } from "../src/mirror/recover";
import { reconcileMirror } from "../src/mirror/reconcile";
import { main as aggregate } from "../src/cli/aggregate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = { owner: "devpool-directory", repo: "devpool-directory" };
const sourceUrl = "https://github.com/ubiquity/ai.ubq.fi/issues/733";
const mirrorUrl = "https://github.com/devpool-directory/devpool-directory/issues/6165";
const source: PartnerIssue = {
  owner: "ubiquity", repo: "ai.ubq.fi", number: 733, node_id: "source-node", title: "Source task",
  url: sourceUrl, state: "closed", labels: ["Price: 75 USD"], assignees: [],
  created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-10T17:00:29Z"
};

function mirror(number = 6165, body = sourceUrl, state = "open") {
  return { number, body, state, html_url: `https://github.com/${directory.owner}/${directory.repo}/issues/${number}`,
    user: { login: "devpool-directory-superintendent[bot]" } };
}

function reader(mirrors: unknown[], sourceRead?: () => Promise<unknown>) {
  return {
    issues: { listForRepo: () => {}, get: sourceRead ?? (async () => { throw new Error("unexpected source read"); }) },
    paginate: async (_method: unknown, args: unknown) => {
      assert.deepEqual(args, { ...directory, state: "all", per_page: 100 });
      return mirrors;
    }
  } as unknown as Octokit;
}

test("recovers an existing closed source beyond the first directory page without creating a mirror", async () => {
  const fillers = Array.from({ length: 100 }, (_, i) => ({ ...mirror(i + 1, "", "closed"), pull_request: {} }));
  const recovered = await recoverMirrorState(reader([...fillers, mirror()]), directory, { "source-node": source }, {}, {});
  assert.deepEqual(recovered.index["source-node"], { number: 6165, url: mirrorUrl });
  assert.equal(recovered.state["source-node"].directory_issue_number, 6165);
  assert.deepEqual(recovered.closures, []);
  const updates: unknown[] = [];
  const write = { rest: { issues: { update: async (args: unknown) => { updates.push(args); } } } } as unknown as Octokit;
  await reconcileMirror(write, directory, { node_id: source.node_id, title: source.title, html_url: source.url, state: source.state, labels: source.labels }, recovered.index);
  assert.deepEqual(updates, [{ ...directory, issue_number: 6165, title: source.title, body: sourceUrl, labels: source.labels, state: "closed" }]);
});

test("preserves saved identities and mirror state across an omitted incremental issue", async () => {
  const saved = { absent: { number: 10, url: "https://github.com/devpool-directory/devpool-directory/issues/10" } };
  const previous = { absent: { assigned: true, assignees: ["owner"], directory_issue_number: 10, directory_issue_url: saved.absent.url } };
  const recovered = await recoverMirrorState(reader([]), directory, {}, saved, previous);
  assert.deepEqual(recovered.index, saved);
  assert.deepEqual(recovered.state, previous);
  assert.notEqual(recovered.index, saved);
});

test("unchanged closed mirrors need no PATCH while retaining their identity", async () => {
  const snapshot = { ...mirror(6165, sourceUrl, "closed"), title: source.title, labels: source.labels.map((name) => ({ name })) };
  const recovered = await recoverMirrorState(reader([snapshot]), directory, { "source-node": source }, {}, {});
  const updates: unknown[] = [];
  const write = { rest: { issues: { update: async (args: unknown) => { updates.push(args); } } } } as unknown as Octokit;
  if (!recovered.unchangedClosed.has(source.node_id)) {
    await reconcileMirror(write, directory, { node_id: source.node_id, title: source.title, html_url: source.url, state: source.state, labels: source.labels }, recovered.index);
  }
  assert.deepEqual(updates, []);
  assert.equal(recovered.index["source-node"].number, 6165);
});

test("reopened sources and changed closed metadata still require PATCH", async () => {
  const snapshot = { ...mirror(6165, sourceUrl, "closed"), title: source.title, labels: source.labels };
  for (const change of [{ state: "open" as const }, { title: "Updated title" }, { labels: ["Price: 150 USD"] }, { url: sourceUrl }]) {
    const issue = { ...source, ...change };
    const actual = "url" in change ? { ...snapshot, body: sourceUrl.replace("github.com", "www.github.com") } : snapshot;
    const recovered = await recoverMirrorState(reader([actual]), directory, { "source-node": issue }, {}, {}, new Set(["source-node"]));
    assert.equal(recovered.unchangedClosed.has(source.node_id), false);
    const updates: Array<{ state: string }> = [];
    const write = { rest: { issues: { update: async (args: { state: string }) => { updates.push(args); } } } } as unknown as Octokit;
    await reconcileMirror(write, directory, { node_id: issue.node_id, title: issue.title, html_url: issue.url, state: issue.state, labels: issue.labels }, recovered.index);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].state, issue.state);
  }
});

test("reuses the oldest canonical mirror and tolerates www without deleting duplicates", async () => {
  const recovered = await recoverMirrorState(reader([mirror(6200), mirror(6165, sourceUrl.replace("github.com", "www.github.com"))]), directory, { "source-node": source }, {}, {});
  assert.equal(recovered.index["source-node"].number, 6165);
});

test("recovers cancelled closure separately from source and reward artifacts, then repeats safely", async () => {
  const calls: unknown[] = [];
  const read = reader([mirror()], async () => ({ data: { node_id: "source-node", html_url: sourceUrl, state: "closed", state_reason: "not_planned" } }));
  const issues: Record<string, PartnerIssue> = {};
  const recovered = await recoverMirrorState(read, directory, issues, {}, {});
  assert.deepEqual(issues, {});
  assert.deepEqual(recovered.cancelledNodeIds, ["source-node"]);
  const write = { issues: { update: async (args: unknown) => { calls.push(args); } } } as unknown as Octokit;
  await applyRecoveredClosures(write, directory, recovered.closures, false);
  assert.deepEqual(calls, [{ ...directory, issue_number: 6165, state: "closed", state_reason: "not_planned" }]);
  const repeated = await recoverMirrorState(reader([mirror(6165, sourceUrl, "closed")]), directory, issues, recovered.index, recovered.state);
  assert.deepEqual(repeated.index, recovered.index);
  assert.deepEqual(repeated.closures, []);
});

test("detects cancellation of a cached open source without retaining it as a new reward", async () => {
  const issues = { "source-node": { ...source, state: "open" as const } };
  const recovered = await recoverMirrorState(reader([mirror()], async () => ({ data: { node_id: "source-node", html_url: sourceUrl, state: "closed", state_reason: "not_planned" } })), directory, issues, {}, {});
  assert.deepEqual(recovered.cancelledNodeIds, ["source-node"]);
  assert.equal(recovered.closures[0].number, 6165);
});

test("freshly fetched open sources do not trigger redundant exact reads", async () => {
  const recovered = await recoverMirrorState(reader([mirror()]), directory, { "source-node": { ...source, state: "open" } }, {}, {}, new Set(["source-node"]));
  assert.equal(recovered.index["source-node"].number, 6165);
});

test("unknown source visibility and failed closure writes fail visibly with identities intact", async () => {
  const saved = { "source-node": { number: 6165, url: mirrorUrl } };
  const read = reader([mirror()], async () => { throw Object.assign(new Error("source unavailable"), { status: 404 }); });
  await assert.rejects(recoverMirrorState(read, directory, {}, saved, {}), /cannot verify source of mirror #6165/);
  assert.equal(saved["source-node"].number, 6165);
  const write = { issues: { update: async () => { throw new Error("write forbidden"); } } } as unknown as Octokit;
  await assert.rejects(applyRecoveredClosures(write, directory, [{ nodeId: "source-node", number: 6165, reason: "completed" }], false), /write forbidden/);
  assert.equal(saved["source-node"].number, 6165);
});

test("rejects unauthorized authors, noncanonical open links, and unpriced cleanup", async () => {
  await assert.rejects(recoverMirrorState(reader([{ ...mirror(), user: { login: "someone" } }]), directory, {}, {}, {}), /untrusted mirror author/);
  await assert.rejects(recoverMirrorState(reader([mirror(6165, `${sourceUrl}\nextra`)]), directory, {}, {}, {}), /unrecognized open mirror body/);
  await assert.rejects(recoverMirrorState(reader([mirror()]), directory, { "source-node": { ...source, state: "open", labels: [] } }, {}, {}, new Set(["source-node"])), /separate cleanup/);
});

async function aggregateFixture(options: { priced?: boolean; outcome?: "completed" | "not_planned"; renamed?: boolean }, run: (fixture: any) => Promise<void>) {
  const cwd = process.cwd();
  const envNames = ["DIRECTORY_OWNER", "DIRECTORY_REPO", "WRITE_TARGET_REPO"] as const;
  const priorEnv = envNames.map((name) => process.env[name]);
  process.env.DIRECTORY_OWNER = directory.owner;
  process.env.DIRECTORY_REPO = directory.repo;
  process.env.WRITE_TARGET_REPO = `${directory.owner}/${directory.repo}`;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "directory-aggregate-regression-"));
  const cached = { ...source, state: "open", labels: options.priced === false ? [] : source.labels };
  const current = { ...cached, ...(options.renamed ? { owner: "ubiquity", repo: "renamed-ai", url: sourceUrl.replace("ai.ubq.fi", "renamed-ai") } : {}) };
  const snapshot: any = { ...mirror(), node_id: "mirror-node", title: source.title, labels: cached.labels };
  const saved: Record<string, any> = {
    "issues-map.json": { "source-node": cached }, "index.json": { "source-node": { number: 6165, url: mirrorUrl } },
    "mirror-state.json": { "source-node": { assigned: false, assignees: [], directory_issue_number: 6165, directory_issue_url: mirrorUrl } },
    "lifetime-map.json": { "source-node": 0 }, "owners-avatars.json": [], "twitter-map.json": {}
  };
  let failPublication = false;
  let pending: any[] = [];
  const updates: any[] = [];
  const issues = {
    get: async () => { if (snapshot.deleted) throw Object.assign(new Error("deleted"), { status: 404 }); return { data: snapshot }; },
    update: async (args: any) => { updates.push(args); Object.assign(snapshot, args); return { data: snapshot }; }
  };
  const write = {
    issues, rest: { issues },
    repos: { getContent: async ({ path: name }: any) => ({ data: { content: Buffer.from(JSON.stringify(saved[name])).toString("base64"), encoding: "base64" } }) },
    git: {
      getRef: async () => ({ data: { object: { sha: "old" } } }), getCommit: async () => ({ data: { tree: { sha: "tree" } } }),
      createTree: async ({ tree }: any) => { pending = tree; return { data: { sha: "tree" } }; },
      createCommit: async () => ({ data: { sha: "commit" } }),
      updateRef: async () => { if (failPublication) throw new Error("publication failed"); for (const change of pending) saved[change.path] = change.path.endsWith(".json") ? JSON.parse(change.content) : change.content; }
    }
  } as unknown as Octokit;
  const read = reader([snapshot], async () => ({ data: { node_id: "source-node", html_url: current.url, state: "closed", state_reason: options.outcome ?? "completed", updated_at: source.updated_at } }));
  (read as any).repos = { get: async () => ({ data: { private: false } }) };
  const remove = { request: async () => { snapshot.deleted = true; return { data: { data: { deleteIssue: { clientMutationId: null } } } }; } } as unknown as Octokit;
  fs.mkdirSync(path.join(scratch, "shards", "shard-0"), { recursive: true });
  fs.writeFileSync(path.join(scratch, "shards", "shard-0", "shard-0-issues.json"), JSON.stringify(options.priced === false || options.renamed ? [current] : []));
  process.chdir(scratch);
  try { await run({ saved, snapshot, updates, invoke: () => aggregate({ write, read, remove }), fail: (value: boolean) => { failPublication = value; } }); }
  finally {
    process.chdir(cwd);
    envNames.forEach((name, i) => { if (priorEnv[i] === undefined) delete process.env[name]; else process.env[name] = priorEnv[i]; });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test("aggregate does not persist a mirror identity after a confirmed hard deletion", async () => {
  await aggregateFixture({ priced: false }, async ({ invoke, saved }: any) => {
    await invoke();
    assert.equal(saved["index.json"]["source-node"], undefined);
    assert.equal(saved["mirror-state.json"]["source-node"].directory_issue_number, undefined);
  });
});

test("aggregate retry after failed publication never reopens a cancelled source", async () => {
  await aggregateFixture({ outcome: "not_planned" }, async ({ invoke, fail, snapshot, saved }: any) => {
    fail(true); await assert.rejects(invoke(), /publication failed/);
    assert.equal(snapshot.state, "closed");
    fail(false); await invoke();
    assert.equal(snapshot.state, "closed");
    assert.equal(saved["issues-map.json"]["source-node"], undefined);
    assert.equal(saved["lifetime-map.json"]["source-node"], 0);
  });
});

test("aggregate accepts a node-stable public repository rename without recreating its mirror", async () => {
  await aggregateFixture({ renamed: true }, async ({ invoke, saved, snapshot }: any) => {
    await invoke();
    assert.equal(saved["index.json"]["source-node"].number, 6165);
    assert.equal(snapshot.body, sourceUrl.replace("ai.ubq.fi", "renamed-ai"));
  });
});

test("aggregate includes an exact-read completion in its lifetime rollup", async () => {
  await aggregateFixture({ outcome: "completed" }, async ({ invoke, saved }: any) => {
    await invoke();
    assert.equal(saved["statistics.json"].lifetime.rewardsCompletedUSD, 75);
    assert.equal(saved["statistics.json"].lifetime.tasksCompletedPriced, 1);
  });
});

test("cached redirects require a stable node and a public destination inside the configured owner", async () => {
  const saved = { "source-node": { number: 6165, url: mirrorUrl } };
  const issues = { "source-node": { ...source, state: "open" as const } };
  for (const [url, node, privateRepo, expected] of [
    [sourceUrl.replace("ai.ubq.fi", "renamed-ai"), "other-node", false, /identity changed/],
    [sourceUrl.replace("ai.ubq.fi", "renamed-ai"), "source-node", true, /not public/],
    [sourceUrl.replace("ubiquity/", "outside-owner/"), "source-node", false, /configured scope/]
  ] as const) {
    const read = reader([mirror()], async () => ({ data: { node_id: node, html_url: url, state: "closed", state_reason: "completed" } }));
    (read as any).repos = { get: async () => ({ data: { private: privateRepo } }) };
    await assert.rejects(recoverMirrorState(read, directory, issues, saved, {}), expected);
  }
});
