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

function exactIssue(issue: PartnerIssue, outcome: "completed" | "not_planned" = "completed") {
  return { ...issue, html_url: issue.url, labels: issue.labels.map((name) => ({ name })),
    assignees: issue.assignees.map((login) => ({ login })), state_reason: issue.state === "closed" ? outcome : null };
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
  const recovered = await recoverMirrorState(reader([mirror(10, sourceUrl, "closed")]), directory, {}, saved, previous);
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

async function aggregateFixture(options: { priced?: boolean; outcome?: "completed" | "not_planned"; renamed?: boolean; redirectRepo?: string; allowedRepos?: string[]; exact?: Partial<PartnerIssue>; noShards?: boolean; discoveredRepos?: string[]; exclude?: string[]; repositoryPrivate?: boolean | null; discoveryError?: boolean }, run: (fixture: any) => Promise<void>) {
  const cwd = process.cwd();
  const envNames = ["DIRECTORY_OWNER", "DIRECTORY_REPO", "WRITE_TARGET_REPO", "CONFIG_PATH"] as const;
  const priorEnv = envNames.map((name) => process.env[name]);
  process.env.DIRECTORY_OWNER = directory.owner;
  process.env.DIRECTORY_REPO = directory.repo;
  process.env.WRITE_TARGET_REPO = `${directory.owner}/${directory.repo}`;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "directory-aggregate-regression-"));
  process.env.CONFIG_PATH = path.join(scratch, "config.json");
  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ include: ["ubiquity"], exclude: options.exclude ?? [] }));
  const cached = { ...source, state: "open", labels: options.priced === false ? [] : source.labels };
  const current = { ...cached, ...(options.redirectRepo ? { repo: options.redirectRepo, url: sourceUrl.replace("ai.ubq.fi", options.redirectRepo) } : {}), ...(options.renamed ? { owner: "ubiquity", repo: "renamed-ai", url: sourceUrl.replace("ai.ubq.fi", "renamed-ai") } : {}) };
  const snapshot: any = { ...mirror(), node_id: "mirror-node", title: source.title, labels: cached.labels };
  const saved: Record<string, any> = {
    "issues-map.json": { "source-node": options.noShards ? current : cached }, "index.json": { "source-node": { number: 6165, url: mirrorUrl } },
    "mirror-state.json": { "source-node": { assigned: false, assignees: [], directory_issue_number: 6165, directory_issue_url: mirrorUrl } },
    "lifetime-map.json": { "source-node": 0 }, "owners-avatars.json": [], "twitter-map.json": {}, "twitter-pending.json": {},
    "sync-metadata.json": { perRepo: { "ubiquity/ai.ubq.fi": { lastSyncISO: "2026-10-17T00:00:00Z", etag: "previous-etag" } } }
  };
  let failPublication = false;
  let pending: any[] = [];
  const updates: any[] = [];
  const creates: any[] = [];
  const scopeReads: any[] = [];
  const publicReads: any[] = [];
  const issues = {
    get: async () => { if (snapshot.deleted) throw Object.assign(new Error("deleted"), { status: 404 }); return { data: snapshot }; },
    update: async (args: any) => { if (snapshot.deleted || args.issue_number !== snapshot.number) throw Object.assign(new Error("deleted identity"), { status: 404 }); updates.push(args); Object.assign(snapshot, args); return { data: snapshot }; },
    listForRepo: async () => ({ data: snapshot.deleted ? [] : [snapshot] }),
    create: async (args: any) => { creates.push(args); Object.assign(snapshot, args, { number: 6166, node_id: "new-mirror", html_url: mirrorUrl.replace("6165", "6166"), deleted: false }); return { data: snapshot }; }
  };
  const write = {
    issues, rest: { issues, search: { issuesAndPullRequests: async () => ({ data: { items: [] } }) } },
    repos: { getContent: async ({ path: name }: any) => ({ data: { content: Buffer.from(JSON.stringify(saved[name])).toString("base64"), encoding: "base64" } }) },
    git: {
      getRef: async () => ({ data: { object: { sha: "old" } } }), getCommit: async () => ({ data: { tree: { sha: "tree" } } }),
      createTree: async ({ tree }: any) => { pending = tree; return { data: { sha: "tree" } }; },
      createCommit: async () => ({ data: { sha: "commit" } }),
      updateRef: async () => { if (failPublication) throw new Error("publication failed"); for (const change of pending) saved[change.path] = change.path.endsWith(".json") ? JSON.parse(change.content) : change.content; }
    }
  } as unknown as Octokit;
  const read = reader([snapshot], async () => ({ data: exactIssue({ ...current, state: "closed", ...options.exact }, options.outcome) }));
  (read as any).repos = { listForOrg: () => {}, get: async (args: unknown) => { publicReads.push(args); return { data: { private: options.repositoryPrivate === undefined ? false : options.repositoryPrivate } }; } };
  (read as any).paginate = async (method: unknown, args: unknown) => {
    if (method === read.repos.listForOrg) {
      scopeReads.push(args);
      if (options.discoveryError) throw new Error("discovery failed");
      return (options.discoveredRepos ?? ["ubiquity/ai.ubq.fi", "ubiquity/renamed-ai"]).map((full) => ({ name: full.split("/")[1] }));
    }
    return snapshot.deleted ? [] : [snapshot];
  };
  const remove = { request: async () => { snapshot.deleted = true; return { data: { data: { deleteIssue: { clientMutationId: null } } } }; } } as unknown as Octokit;
  if (!options.noShards) {
    fs.mkdirSync(path.join(scratch, "shards", "shard-0"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "shards", "shard-0", "shard-0-issues.json"), JSON.stringify(options.priced === false || options.renamed ? [current] : []));
    fs.writeFileSync(path.join(scratch, "shards", "shard-0", "shard-0-sync-meta.json"), JSON.stringify(Object.fromEntries((options.allowedRepos ?? ["ubiquity/ai.ubq.fi", ...(options.renamed ? ["ubiquity/renamed-ai"] : [])]).map((repo) => [repo, { lastSyncISO: "2026-10-18T00:00:00Z" }]))));
  }
  process.chdir(scratch);
  try { await run({ saved, snapshot, updates, creates, scopeReads, publicReads, scratch, closeSource: () => { current.state = "closed"; fs.writeFileSync(path.join(scratch, "shards", "shard-0", "shard-0-issues.json"), JSON.stringify([current])); }, reprice: () => { current.labels = source.labels; fs.writeFileSync(path.join(scratch, "shards", "shard-0", "shard-0-issues.json"), JSON.stringify([current])); }, invoke: () => aggregate({ write, read, remove }), fail: (value: boolean) => { failPublication = value; } }); }
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
    assert.equal(saved["statistics.json"].lifetime.rewardsCompletedUSD, 0);
    assert.deepEqual(saved["partner-open-issues.json"], []);
    assert.deepEqual(saved["partner-open-proposals.json"], []);
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

test("aggregate publishes current exact-read metadata and completed price instead of cached values", async () => {
  const current = { ...source, title: "Updated source task", body: "Current source body", labels: ["Price: 150 USD", "Time: <1 Hour"],
    assignees: ["current-contributor"], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-18T01:00:00Z" };
  await aggregateFixture({ exact: current }, async ({ invoke, saved, snapshot }: any) => {
    await invoke();
    assert.deepEqual(saved["issues-map.json"][source.node_id], current);
    assert.equal(saved["lifetime-map.json"][source.node_id], 150);
    assert.equal(saved["statistics.json"].lifetime.rewardsCompletedUSD, 150);
    assert.equal(saved["statistics.json"].lifetime.tasksCompletedPriced, 1);
    assert.deepEqual(saved["partner-open-issues.json"], []);
    assert.deepEqual(saved["partner-open-proposals.json"], []);
    assert.equal(snapshot.title, current.title);
    assert.deepEqual(snapshot.labels, current.labels);
    assert.equal(snapshot.state, "closed");
    assert.deepEqual(saved["index.json"][source.node_id], { number: 6165, url: mirrorUrl });
    assert.deepEqual(saved["mirror-state.json"][source.node_id].assignees, current.assignees);
  });
});

test("aggregate publishes an omitted exact-read source as an unpriced proposal after its price is removed", async () => {
  const current = { ...source, state: "open" as const, title: "Current proposal", body: "Proposal body", labels: ["Time: <1 Hour"],
    assignees: ["proposal-owner"], updated_at: "2026-10-18T02:00:00Z" };
  await aggregateFixture({ exact: current }, async ({ invoke, saved, snapshot, updates }: any) => {
    await invoke();
    assert.deepEqual(saved["issues-map.json"][source.node_id], current);
    assert.deepEqual(saved["partner-open-issues.json"], []);
    assert.deepEqual(saved["partner-open-proposals.json"], [current]);
    assert.equal(saved["statistics.json"].lifetime.rewardsCompletedUSD, 0);
    assert.equal(saved["statistics.json"].lifetime.tasksCompletedPriced, 0);
    assert.equal(snapshot.deleted, true);
    assert.equal(saved["index.json"][source.node_id], undefined);
    assert.equal(saved["mirror-state.json"][source.node_id].directory_issue_number, undefined);
    assert.equal(saved["mirror-state.json"][source.node_id].price_label, null);
    assert.deepEqual(saved["mirror-state.json"][source.node_id].assignees, current.assignees);
    assert.deepEqual(updates, []);
  });
});

test("aggregate excludes an exact-read unpriced completion from lifetime rewards", async () => {
  await aggregateFixture({ exact: { labels: [] } }, async ({ invoke, saved }: any) => {
    await invoke();
    assert.equal(saved["lifetime-map.json"][source.node_id], 0);
    assert.equal(saved["statistics.json"].lifetime.rewardsCompletedUSD, 0);
    assert.equal(saved["statistics.json"].lifetime.tasksCompletedPriced, 0);
    assert.deepEqual(saved["partner-open-issues.json"], []);
    assert.deepEqual(saved["partner-open-proposals.json"], []);
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
    await assert.rejects(recoverMirrorState(read, directory, issues, saved, {}, new Set(), new Set(["ubiquity/renamed-ai", "outside-owner/ai.ubq.fi"])), expected);
  }
});


test("aggregate repricing after deletion and failed publication never reuses a ghost identity", async () => {
  await aggregateFixture({ priced: false }, async ({ invoke, fail, reprice, snapshot, saved }: any) => {
    fail(true); await assert.rejects(invoke(), /publication failed/);
    assert.equal(snapshot.deleted, true);
    fail(false); reprice(); await invoke();
    assert.equal(snapshot.deleted, false);
    assert.equal(saved["index.json"]["source-node"].number, 6166);
    assert.equal(saved["mirror-state.json"]["source-node"].directory_issue_number, 6166);
  });
});

test("aggregate rejects excluded same-owner public redirect destinations", async () => {
  await aggregateFixture({ redirectRepo: "hackbar", allowedRepos: ["ubiquity/ai.ubq.fi"] }, async ({ invoke, updates }: any) => {
    await assert.rejects(invoke(), /configured scope/);
    assert.deepEqual(updates, []);
  });
});

test("confirmed missing identities clear both maps without mutating prior metadata", async () => {
  const saved = { "source-node": { number: 6165, url: mirrorUrl } };
  const previous = { "source-node": { assigned: true, assignees: ["owner"], price_label: "Price: 75 USD", directory_issue_number: 6165, directory_issue_url: mirrorUrl } };
  const recovered = await recoverMirrorState(reader([]), directory, { "source-node": source }, saved, previous);
  assert.equal(recovered.index["source-node"], undefined);
  assert.deepEqual(recovered.state["source-node"], { assigned: true, assignees: ["owner"], price_label: "Price: 75 USD" });
  assert.equal(saved["source-node"].number, 6165);
  assert.equal(previous["source-node"].directory_issue_number, 6165);
});

test("redirects fail closed when no current discovery scope is supplied", async () => {
  const saved = { "source-node": { number: 6165, url: mirrorUrl } };
  const read = reader([mirror()], async () => ({ data: { node_id: "source-node", html_url: sourceUrl.replace("ai.ubq.fi", "renamed-ai"), state: "closed" } }));
  await assert.rejects(recoverMirrorState(read, directory, { "source-node": { ...source, state: "open" } }, saved, {}), /configured scope/);
});


test("aggregate closing a source after deletion and failed publication does not PATCH its ghost", async () => {
  await aggregateFixture({ priced: false }, async ({ invoke, fail, closeSource, snapshot, saved }: any) => {
    fail(true); await assert.rejects(invoke(), /publication failed/);
    fail(false); closeSource(); await invoke();
    assert.equal(snapshot.deleted, true);
    assert.equal(saved["index.json"]["source-node"], undefined);
    assert.equal(saved["mirror-state.json"]["source-node"].directory_issue_number, undefined);
  });
});

test("backfill aggregation discovers a public rename without shards and preserves identity and watermarks on retry", async () => {
  await aggregateFixture({ noShards: true, renamed: true }, async ({ invoke, saved, snapshot, creates, updates, scopeReads, publicReads, scratch }: any) => {
    assert.equal(fs.existsSync(path.join(scratch, "shards")), false);
    const watermarks = structuredClone(saved["sync-metadata.json"]);
    await invoke();
    assert.deepEqual(saved["index.json"][source.node_id], { number: 6165, url: mirrorUrl });
    assert.equal(saved["mirror-state.json"][source.node_id].directory_issue_number, 6165);
    assert.equal(saved["issues-map.json"][source.node_id].url, sourceUrl.replace("ai.ubq.fi", "renamed-ai"));
    assert.equal(snapshot.body, sourceUrl.replace("ai.ubq.fi", "renamed-ai"));
    assert.equal(snapshot.node_id, "mirror-node");
    assert.equal(snapshot.state, "closed");
    assert.deepEqual(publicReads, [{ owner: "ubiquity", repo: "renamed-ai" }]);
    assert.deepEqual(saved["sync-metadata.json"], watermarks);
    const writes = updates.length;
    await invoke();
    assert.equal(updates.length, writes);
    assert.equal(scopeReads.length, 2);
    assert.deepEqual(creates, []);
    assert.deepEqual(saved["sync-metadata.json"], watermarks);
    assert.equal(saved["index.json"][source.node_id].number, 6165);
  });
});

for (const { name, options, expected } of [
  { name: "excluded", options: { exclude: ["ubiquity/renamed-ai"] }, expected: /configured scope/ },
  { name: "private", options: { repositoryPrivate: true }, expected: /not public/ },
  { name: "unknown visibility", options: { repositoryPrivate: null }, expected: /not public/ },
  { name: "unknown scope", options: { discoveredRepos: ["ubiquity/ai.ubq.fi"] }, expected: /configured scope/ },
  { name: "mismatched node", options: { exact: { node_id: "another-node" } }, expected: /identity changed/ },
  { name: "failed discovery", options: { discoveryError: true }, expected: /discovery failed/ }
]) {
  test(`backfill aggregation rejects ${name} redirects before publication`, async () => {
    await aggregateFixture({ noShards: true, renamed: true, ...options }, async ({ invoke, saved, updates, creates }: any) => {
      saved["sync-metadata.json"].perRepo["ubiquity/renamed-ai"] = { lastSyncISO: "2026-10-17T00:00:00Z" };
      const before = structuredClone(saved);
      await assert.rejects(invoke(), expected);
      assert.deepEqual(saved, before);
      assert.deepEqual(updates, []);
      assert.deepEqual(creates, []);
    });
  });
}

for (const input of ["empty tree", "missing metadata", "another incomplete shard"]) {
  test(`aggregate rejects ${input} instead of using backfill discovery`, async () => {
    await aggregateFixture({ noShards: input === "empty tree", renamed: true }, async ({ invoke, saved, updates, scopeReads, scratch }: any) => {
      if (input === "empty tree") fs.mkdirSync(path.join(scratch, "shards"));
      else if (input === "missing metadata") fs.rmSync(path.join(scratch, "shards", "shard-0", "shard-0-sync-meta.json"));
      else {
        fs.mkdirSync(path.join(scratch, "shards", "shard-1"));
        fs.writeFileSync(path.join(scratch, "shards", "shard-1", "shard-1-issues.json"), "[]");
      }
      const before = structuredClone(saved);
      await assert.rejects(invoke(), /missing shard sync metadata/);
      assert.deepEqual(saved, before);
      assert.deepEqual(scopeReads, []);
      assert.deepEqual(updates, []);
    });
  });
}

test("backfill aggregation restores missing mappings and completes the existing mirror", async () => {
  await aggregateFixture({ noShards: true }, async ({ invoke, saved, snapshot, creates }: any) => {
    saved["index.json"] = {};
    saved["mirror-state.json"] = {};
    saved["issues-map.json"][source.node_id] = source;
    await invoke();
    assert.deepEqual(saved["index.json"][source.node_id], { number: 6165, url: mirrorUrl });
    assert.equal(saved["mirror-state.json"][source.node_id].directory_issue_number, 6165);
    assert.equal(snapshot.state, "closed");
    assert.deepEqual(creates, []);
  });
});

test("backfill aggregation publishes an empty source set without clearing watermarks", async () => {
  await aggregateFixture({ noShards: true }, async ({ invoke, saved, snapshot }: any) => {
    saved["issues-map.json"] = {};
    saved["index.json"] = {};
    saved["mirror-state.json"] = {};
    snapshot.deleted = true;
    const watermarks = structuredClone(saved["sync-metadata.json"]);
    await invoke();
    assert.deepEqual(saved["partner-open-issues.json"], []);
    assert.deepEqual(saved["partner-open-proposals.json"], []);
    assert.deepEqual(saved["index.json"], {});
    assert.deepEqual(saved["sync-metadata.json"], watermarks);
  });
});

test("backfill aggregation rejects invalid saved watermarks instead of replacing them", async () => {
  await aggregateFixture({ noShards: true }, async ({ invoke, saved, updates }: any) => {
    saved["sync-metadata.json"] = { perRepo: [] };
    await assert.rejects(invoke(), /invalid sync metadata artifact/);
    assert.deepEqual(saved["sync-metadata.json"], { perRepo: [] });
    assert.deepEqual(updates, []);
  });
});
