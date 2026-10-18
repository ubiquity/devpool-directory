import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { Octokit } from "@octokit/rest";
import { fetchIssuesForRepoGQL, fetchPRsForRepoGQL } from "../src/fetch-graphql";

afterEach(() => mock.restoreAll());

function node(number: number, updatedAt = "2026-10-12T00:00:00Z") {
  return {
    id: `I_${number}`, number, title: `Item ${number}`, body: "Source body",
    url: `https://github.com/partner/repo/issues/${number}`, state: "OPEN", stateReason: null,
    createdAt: "2026-10-01T00:00:00Z", updatedAt,
    labels: { nodes: [{ name: "Price: 100 USD" }] }, assignees: { nodes: [{ login: "contributor" }] },
  };
}

function servePages(connection: "issues" | "pullRequests", pages: ReturnType<typeof node>[][], hasMore = false) {
  const cursors: Array<string | undefined> = [];
  mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    const { variables } = JSON.parse(String(init.body));
    const page = cursors.length;
    assert.equal(variables.after, page === 0 ? undefined : `cursor-${page}`);
    cursors.push(variables.after);
    assert.ok(page < pages.length, "must not read beyond the cutoff or final page");
    return new Response(JSON.stringify({ data: { repository: { [connection]: {
      nodes: pages[page],
      pageInfo: { hasNextPage: page < pages.length - 1 || hasMore, endCursor: `cursor-${page + 1}` },
    } } } }), { headers: { "content-type": "application/json" } });
  });
  return cursors;
}

for (const [connection, fetchItems] of [
  ["issues", fetchIssuesForRepoGQL], ["pullRequests", fetchPRsForRepoGQL],
] as const) {
  test(`${connection}: fetches all pages beyond 100 items`, async () => {
    const nodes = Array.from({ length: 125 }, (_, i) => node(i + 1));
    const cursors = servePages(connection, [nodes.slice(0, 100), nodes.slice(100)]);
    const result = await fetchItems({} as Octokit, "partner/repo");
    assert.deepEqual(result.map((item) => item.number), nodes.map((item) => item.number));
    assert.deepEqual(cursors, [undefined, "cursor-1"]);
  });

  test(`${connection}: includes the cutoff boundary and stops within a later page`, async () => {
    const first = Array.from({ length: 100 }, (_, i) => node(i + 1));
    const boundary = node(101, "2026-10-10T00:00:00Z");
    const older = node(102, "2026-10-09T00:00:00Z");
    const cursors = servePages(connection, [first, [boundary, older]], true);
    const result = await fetchItems({} as Octokit, "partner/repo", "2026-10-10T00:00:00Z");
    assert.equal(result.length, 101);
    assert.equal(result.at(-1)?.number, 101);
    assert.deepEqual(cursors, [undefined, "cursor-1"]);
  });

  test(`${connection}: stops at a cutoff on the first page`, async () => {
    const cursors = servePages(connection, [[node(1), node(2, "2026-10-09T00:00:00Z")]], true);
    const result = await fetchItems({} as Octokit, "partner/repo", "2026-10-10T00:00:00Z");
    assert.deepEqual(result.map((item) => item.number), [1]);
    assert.deepEqual(cursors, [undefined]);
  });
}

test("issues: preserves cancellation filtering and completed closures", async () => {
  const cancelled = { ...node(1), state: "CLOSED", stateReason: "NOT_PLANNED" };
  const completed = { ...node(2), state: "CLOSED", stateReason: "COMPLETED" };
  servePages("issues", [[cancelled, completed, node(3)]]);
  const result = await fetchIssuesForRepoGQL({} as Octokit, "partner/repo");
  assert.deepEqual(result.map((item) => [item.number, item.state]), [[2, "closed"], [3, "open"]]);
  assert.deepEqual(result[0].labels, ["Price: 100 USD"]);
  assert.deepEqual(result[0].assignees, ["contributor"]);
});
