import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Octokit } from "@octokit/rest";
import { ApiResponseError, type TwitterApi } from "twitter-api-v2";
import type { PartnerIssue } from "../src/artifacts/types";
import { main as aggregate } from "../src/cli/aggregate";
import { main as runShard } from "../src/cli/sync-shard";

const directory = { owner: "devpool-directory", repo: "devpool-directory" };
function source(repo = "first", number = 1): PartnerIssue {
  return { owner: "partner", repo, number, node_id: `source-${repo}`, title: "Current task", body: "Work to do",
    url: `https://github.com/partner/${repo}/issues/${number}`, labels: ["Price: 75 USD", "Time: <2 Hours"],
    assignees: [], state: "open", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" };
}
function restIssue(issue: PartnerIssue) {
  return { ...issue, html_url: issue.url, labels: issue.labels.map((name) => ({ name })),
    assignees: issue.assignees.map((login) => ({ login })) };
}
function responseError(code: number, data: any = {}) {
  return new ApiResponseError("fake Twitter rejection", { code, data, headers: {}, request: {} as any, response: {} as any });
}

async function fixture(run: (f: any) => Promise<void>) {
  const cwd = process.cwd();
  const originalArgv = [...process.argv];
  const names = ["DIRECTORY_OWNER", "DIRECTORY_REPO", "WRITE_TARGET_REPO", "DATA_BRANCH", "USE_GRAPHQL", "MIRRORS_IN_AGGREGATE",
    "FULL_RESYNC", "FORCE_FULL_RESYNC", "DRY_RUN", "TWEET_ON_CREATE", "DELETE_TWEET_ON_COMPLETE"];
  const previous = names.map((name) => process.env[name]);
  Object.assign(process.env, { DIRECTORY_OWNER: directory.owner, DIRECTORY_REPO: directory.repo,
    WRITE_TARGET_REPO: `${directory.owner}/${directory.repo}`, DATA_BRANCH: "__STORAGE__", USE_GRAPHQL: "false",
    MIRRORS_IN_AGGREGATE: "true", FULL_RESYNC: "false", FORCE_FULL_RESYNC: "false", DRY_RUN: "false",
    TWEET_ON_CREATE: "true", DELETE_TWEET_ON_COMPLETE: "true" });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "directory-twitter-lifecycle-"));
  const sources = [source()];
  const saved: Record<string, any> = { "owners-avatars.json": [], "issues-map.json": {}, "mirror-state.json": {},
    "index.json": {}, "twitter-map.json": {}, "lifetime-map.json": {},
    "sync-metadata.json": { perRepo: { "partner/first": { lastSyncISO: "2026-10-01T00:00:00Z" } } } };
  const events: string[] = [];
  const posts: string[] = [];
  const deletes: string[] = [];
  const apiCalls: string[] = [];
  const liveTweets: any[] = [];
  const mirrors = () => sources.map((issue, i) => ({ number: i + 10, body: issue.url, title: issue.title, state: issue.state,
    labels: issue.labels, html_url: `https://github.com/${directory.owner}/${directory.repo}/issues/${i + 10}`,
    user: { login: "devpool-directory-superintendent[bot]" } }));
  let failedRead: "issues" | "prs" | undefined;
  let failSource = false;
  let failReceipt = false;
  let failPost = false;
  let postError: unknown;
  let timelineRows: any[] | undefined;
  let timelineDone = true;
  let timelineErrors: any[] = [];
  let timelineFailure = false;
  let currentAccount = "account-1";
  let scanned = 0;
  let pendingTree: Array<{ path: string; content: string }> = [];
  const issueRoute = () => {};
  const prRoute = () => {};
  const read = {
    issues: { listForRepo: issueRoute, get: async ({ repo }: any) => ({ data: restIssue(sources.find((issue) => issue.repo === repo)!) }) },
    pulls: { list: prRoute }, users: { getByUsername: async () => ({ data: { avatar_url: "https://example.test/avatar" } }) },
    paginate: async (route: unknown, args: any) => {
      if (args.owner === directory.owner) return mirrors();
      const kind = route === issueRoute ? "issues" : "prs";
      if (args.repo === "second" && kind === failedRead) throw new Error(`failed ${kind} fetch`);
      return kind === "issues" ? sources.filter((issue) => issue.repo === args.repo).map(restIssue) : [];
    }
  } as unknown as Octokit;
  const issueWrites = {
    update: async (args: unknown) => ({ data: args }),
    listForRepo: async () => ({ data: mirrors() })
  };
  const write = {
    issues: issueWrites, rest: { issues: issueWrites },
    repos: { getContent: async ({ path: name }: any) => {
      if (!(name in saved)) throw Object.assign(new Error("missing artifact"), { status: 404 });
      return { data: { encoding: "base64", content: Buffer.from(JSON.stringify(saved[name])).toString("base64") } };
    } },
    git: {
      getRef: async () => ({ data: { object: { sha: "head" } } }),
      getCommit: async () => ({ data: { tree: { sha: "tree" } } }),
      createTree: async ({ tree }: any) => { pendingTree = tree; return { data: { sha: "tree" } }; },
      createCommit: async () => ({ data: { sha: "commit" } }),
      updateRef: async () => {
        const sourceCommit = pendingTree.some((entry) => entry.path === "issues-map.json");
        if (sourceCommit ? failSource : failReceipt && posts.length) throw new Error(sourceCommit ? "source publication failed" : "receipt publication failed");
        for (const change of pendingTree) saved[change.path] = change.path.endsWith(".json") ? JSON.parse(change.content) : change.content;
        events.push(sourceCommit ? "source commit" : Object.values(saved["twitter-pending.json"]).some((entry: any) => entry.createAttempt) ? "attempt commit" : "receipt commit");
      }
    }
  } as unknown as Octokit;
  const twitter = { v2: {
    me: async () => { apiCalls.push("me"); return { data: { id: currentAccount } }; },
    userTimeline: async (accountId: string, params: any) => {
      apiCalls.push("timeline");
      assert.equal(accountId, currentAccount);
      assert.deepEqual(params["tweet.fields"], ["created_at", "author_id", "entities"]);
      assert.equal(params.max_results, 100);
      if (timelineFailure) throw new Error("timeline unavailable");
      return { done: timelineDone, errors: timelineErrors, async *[Symbol.asyncIterator]() {
        for (const tweet of timelineRows ?? liveTweets) { scanned++; yield tweet; }
      } };
    },
    tweet: async (text: string) => {
      apiCalls.push("post");
      const originalUrl = text.trim().split("\n").pop()!;
      const node = sources.find((issue) => issue.url === originalUrl)!.node_id;
      assert.ok(saved["twitter-pending.json"][node].createAttempt, "attempt must be durable before posting");
      events.push("post");
      if (failPost) throw responseError(429);
      if (postError) throw postError;
      posts.push(text);
      liveTweets.push({ id: `tweet-${posts.length}`, author_id: currentAccount,
        created_at: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
        entities: { urls: [{ expanded_url: originalUrl, unwound_url: originalUrl, url: "https://t.co/short" }] } });
      return { data: { id: `tweet-${posts.length}` } };
    },
    deleteTweet: async (id: string) => { apiCalls.push("delete"); deletes.push(id); events.push("delete"); return { data: { deleted: true } }; }
  } } as unknown as TwitterApi;
  const setDelta = (issues: PartnerIssue[]) => {
    const dir = path.join(scratch, "shards", "shard-0");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "shard-0-issues.json"), JSON.stringify(issues));
    fs.writeFileSync(path.join(dir, "shard-0-sync-meta.json"), JSON.stringify({ "partner/first": { lastSyncISO: "2026-10-18T00:00:00Z" } }));
  };
  fs.writeFileSync(path.join(scratch, "plan.json"), JSON.stringify({ matrix: { include: [
    { shard_id: 0, repos: ["partner/first"] }, { shard_id: 1, repos: ["partner/second"] }
  ] } }));
  fs.writeFileSync(path.join(scratch, "issues-map.json"), "{}");
  process.chdir(scratch);
  try {
    await run({ sources, saved, events, posts, deletes, apiCalls, liveTweets, setDelta, invoke: () => aggregate({ write, read, remove: write, twitter }),
      failSource: (value: boolean) => { failSource = value; }, failReceipt: (value: boolean) => { failReceipt = value; },
      failPost: (value: boolean) => { failPost = value; }, failedRead: (value?: "issues" | "prs") => { failedRead = value; },
      postError: (value: unknown) => { postError = value; }, account: (value: string) => { currentAccount = value; },
      timeline: (rows?: any[], done = true, errors: any[] = [], failed = false) => {
        timelineRows = rows; timelineDone = done; timelineErrors = errors; timelineFailure = failed;
      }, scanned: () => scanned,
      shard: async (id: number) => {
        process.argv = [...originalArgv, "--shard", String(id)];
        await runShard({ write, read });
        const dir = path.join(scratch, "shards", `shard-${id}`);
        fs.mkdirSync(dir, { recursive: true });
        for (const name of fs.readdirSync("out").filter((name) => name.startsWith(`shard-${id}-`))) fs.copyFileSync(path.join("out", name), path.join(dir, name));
      } });
  } finally {
    process.argv = originalArgv;
    process.chdir(cwd);
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

for (const kind of ["issues", "prs"] as const) {
  test(`mixed shard ${kind} failure posts nothing; successful retry persists once and completion deletes its receipt`, async () => {
    await fixture(async (f) => {
      const before = structuredClone(f.saved);
      f.failedRead(kind);
      await f.shard(0);
      await assert.rejects(f.shard(1), new RegExp(`failed ${kind} fetch`));
      assert.deepEqual(f.posts, []);
      assert.deepEqual(f.deletes, []);
      assert.deepEqual(f.saved, before, "failed source sync must not advance persisted state");
      f.failedRead();
      await f.shard(0);
      await f.shard(1);
      await f.invoke();
      assert.deepEqual(f.events, ["source commit", "attempt commit", "post", "receipt commit"]);
      assert.equal(f.saved["twitter-map.json"]["source-first"], "tweet-1");
      assert.deepEqual(f.saved["twitter-pending.json"], {});
      f.setDelta([]);
      await f.invoke();
      assert.equal(f.posts.length, 1);
      f.sources[0].state = "closed";
      f.setDelta([f.sources[0]]);
      await f.invoke();
      assert.deepEqual(f.deletes, ["tweet-1"]);
      assert.deepEqual(f.saved["twitter-map.json"], {});
      assert.deepEqual(f.saved["twitter-pending.json"], {});
    });
  });
}

test("failed source publication leaves Twitter and persisted artifacts untouched", async () => {
  await fixture(async (f) => {
    const before = structuredClone(f.saved);
    f.setDelta(f.sources);
    f.failSource(true);
    await assert.rejects(f.invoke(), /source publication failed/);
    assert.deepEqual(f.posts, []);
    assert.deepEqual(f.saved, before);
  });
});

test("a failed post retries from its durable outbox when the next source delta is empty", async () => {
  await fixture(async (f) => {
    f.setDelta(f.sources);
    f.failPost(true);
    await f.invoke();
    assert.ok(f.saved["twitter-pending.json"]["source-first"]);
    assert.deepEqual(f.saved["twitter-map.json"], {});
    assert.equal(f.saved["sync-metadata.json"].perRepo["partner/first"].lastSyncISO, "2026-10-18T00:00:00Z");
    f.failPost(false);
    f.setDelta([]);
    await f.invoke();
    assert.equal(f.posts.length, 1);
    assert.equal(f.saved["twitter-map.json"]["source-first"], "tweet-1");
    assert.deepEqual(f.saved["twitter-pending.json"], {});
    await f.invoke();
    assert.equal(f.posts.length, 1);
  });
});

for (const state of ["open", "closed"] as const) {
  test(`disabled full-resync controls suppress ${state} lifecycle actions`, async () => {
    await fixture(async (f) => {
      process.env.TWEET_ON_CREATE = "false";
      process.env.DELETE_TWEET_ON_COMPLETE = "false";
      f.sources[0].state = state;
      if (state === "closed") f.saved["twitter-map.json"]["source-first"] = "existing-tweet";
      f.setDelta(f.sources);
      await f.invoke();
      assert.deepEqual(f.posts, []);
      assert.deepEqual(f.deletes, []);
      assert.deepEqual(f.apiCalls, []);
      assert.deepEqual(f.saved["twitter-pending.json"], {});
      if (state === "closed") assert.equal(f.saved["twitter-map.json"]["source-first"], "existing-tweet");
    });
  });
}

test("new posts are limited to fresh shard candidates rather than all historical issues", async () => {
  await fixture(async (f) => {
    const historical = source("historical", 2);
    f.sources.push(historical);
    f.saved["issues-map.json"][historical.node_id] = historical;
    f.setDelta([f.sources[0]]);
    await f.invoke();
    assert.equal(f.posts.length, 1);
    assert.match(f.posts[0], /partner\/first\/issues\/1/);
    assert.equal(f.saved["twitter-map.json"][historical.node_id], undefined);
  });
});

test("receipt failure stops later actions; unattended retry recovers the same-second original and exact completion deletes it", async () => {
  await fixture(async (f) => {
    const clock = Date.now;
    const now = Math.floor(clock() / 1000) * 1000 + 123;
    Date.now = () => now;
    try {
      f.sources.push(source("second", 2));
      f.setDelta(f.sources);
      f.failReceipt(true);
      await assert.rejects(f.invoke(), /receipt persistence failed for source source-first, tweet tweet-1/);
      assert.equal(f.posts.length, 1);
      assert.deepEqual(f.saved["twitter-map.json"], {});
      assert.equal(Object.keys(f.saved["twitter-pending.json"]).length, 2);
      assert.deepEqual(f.events, ["source commit", "attempt commit", "post"]);
      assert.equal(f.liveTweets[0].created_at, f.saved["twitter-pending.json"]["source-first"].createAttempt.startedAtISO);
      f.failReceipt(false);
      f.setDelta([]);
      await f.invoke();
      assert.equal(f.posts.filter((text: string) => text.endsWith(f.sources[0].url)).length, 1);
      assert.equal(f.saved["twitter-map.json"]["source-first"], "tweet-1");
      f.sources[0].state = "closed";
      await f.invoke();
      assert.deepEqual(f.deletes, ["tweet-1"]);
      assert.equal(f.saved["twitter-map.json"]["source-first"], undefined);
    } finally { Date.now = clock; }
  });
});

for (const outcome of ["absent", "ambiguous", "incomplete", "partial error", "unavailable", "wrong account", "wrong time", "wrong URL", "scan limit"] as const) {
  test(`unresolved ${outcome} timeline evidence never authorizes another post`, async () => {
    await fixture(async (f) => {
      f.setDelta(f.sources); f.failReceipt(true);
      await assert.rejects(f.invoke(), /receipt persistence failed/);
      f.failReceipt(false); f.setDelta([]);
      const tweet = f.liveTweets[0];
      if (outcome === "absent") f.timeline([]);
      if (outcome === "ambiguous") f.timeline([tweet, { ...tweet, id: "other-tweet" }]);
      if (outcome === "incomplete") f.timeline([tweet], false);
      if (outcome === "partial error") f.timeline([tweet], true, [{ title: "partial" }]);
      if (outcome === "unavailable") f.timeline(undefined, true, [], true);
      if (outcome === "wrong account") f.account("another-account");
      if (outcome === "wrong time") f.timeline([{ ...tweet, created_at: "2020-01-01T00:00:00Z" }]);
      if (outcome === "wrong URL") f.timeline([{ ...tweet, entities: { urls: [{ expanded_url: `${f.sources[0].url}0` }] } }]);
      if (outcome === "scan limit") f.timeline(Array.from({ length: 1001 }, (_, i) => ({ ...tweet, id: `unrelated-${i}`, entities: { urls: [] } })), false);
      await assert.rejects(f.invoke(), /unresolved Twitter creation/);
      assert.equal(f.posts.length, 1);
      assert.ok(f.saved["twitter-pending.json"]["source-first"].createAttempt);
      if (outcome === "scan limit") assert.equal(f.scanned(), 1000);
    });
  });
}

for (const change of ["closed", "unpriced", "cancelled"] as const) {
  test(`an unresolved attempt survives ${change} source metadata and cleans up the recovered original`, async () => {
    await fixture(async (f) => {
      f.setDelta(f.sources); f.failReceipt(true);
      await assert.rejects(f.invoke(), /receipt persistence failed/);
      f.failReceipt(false); f.setDelta([]);
      if (change === "unpriced") f.sources[0].labels = [];
      else f.sources[0].state = "closed";
      if (change === "cancelled") f.sources[0].state_reason = "not_planned";
      await f.invoke();
      assert.equal(f.posts.length, 1);
      assert.deepEqual(f.deletes, ["tweet-1"]);
      assert.deepEqual(f.saved["twitter-pending.json"], {});
      assert.deepEqual(f.saved["twitter-map.json"], {});
    });
  });
}

for (const error of [new Error("transport timeout"), responseError(503), responseError(403, { errors: [{ code: 187, message: "duplicate content" }] })]) {
  test(`ambiguous post response ${error.message} retains its attempt and never blindly retries`, async () => {
    await fixture(async (f) => {
      f.setDelta(f.sources); f.postError(error);
      await assert.rejects(f.invoke(), /ambiguous Twitter creation/);
      assert.ok(f.saved["twitter-pending.json"]["source-first"].createAttempt);
      f.postError(undefined); f.setDelta([]);
      await assert.rejects(f.invoke(), /unresolved Twitter creation/);
      assert.equal(f.apiCalls.filter((call: string) => call === "post").length, 1);
    });
  });
}

test("both disabled controls preserve an unresolved attempt without any Twitter API calls", async () => {
  await fixture(async (f) => {
    f.setDelta(f.sources); f.failReceipt(true);
    await assert.rejects(f.invoke(), /receipt persistence failed/);
    const attempt = structuredClone(f.saved["twitter-pending.json"]["source-first"].createAttempt);
    f.failReceipt(false); f.setDelta([]); f.apiCalls.length = 0;
    process.env.TWEET_ON_CREATE = "false"; process.env.DELETE_TWEET_ON_COMPLETE = "false";
    await f.invoke();
    assert.deepEqual(f.apiCalls, []);
    assert.deepEqual(f.saved["twitter-pending.json"]["source-first"].createAttempt, attempt);
  });
});
