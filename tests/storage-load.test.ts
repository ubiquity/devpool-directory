import test from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import { loadArtifact } from "../src/storage/load";

test("loads a large artifact through its authenticated blob instead of empty inline content", async () => {
  const saved = { old: { number: 6165 }, padding: "x".repeat(1024 * 1024) };
  const client = {
    repos: { getContent: async () => ({ data: { type: "file", sha: "blob-sha", encoding: "none", content: "", size: 2400000 } }) },
    git: { getBlob: async (args: unknown) => {
      assert.deepEqual(args, { owner: "owner", repo: "repo", file_sha: "blob-sha" });
      return { data: { encoding: "base64", content: Buffer.from(JSON.stringify(saved)).toString("base64") } };
    } }
  } as unknown as Octokit;
  assert.deepEqual(await loadArtifact(client, "owner", "repo", "issues-map.json", "__STORAGE__"), saved);
});

test("only a missing content path returns empty state", async () => {
  for (const status of [404, 403]) {
    const client = { repos: { getContent: async () => { throw Object.assign(new Error("read failed"), { status }); } } } as unknown as Octokit;
    const read = loadArtifact(client, "owner", "repo", "index.json", "__STORAGE__");
    if (status === 404) assert.equal(await read, null);
    else await assert.rejects(read, /read failed/);
  }
});

test("malformed artifacts and directory responses fail visibly", async () => {
  for (const data of [{ content: Buffer.from("{").toString("base64"), encoding: "base64" }, { content: Buffer.from("null").toString("base64"), encoding: "base64" }, []]) {
    const client = { repos: { getContent: async () => ({ data }) } } as unknown as Octokit;
    await assert.rejects(loadArtifact(client, "owner", "repo", "index.json", "__STORAGE__"));
  }
});

test("a missing blob for an existing large artifact does not become empty state", async () => {
  const client = {
    repos: { getContent: async () => ({ data: { sha: "blob", encoding: "none", content: "" } }) },
    git: { getBlob: async () => { throw Object.assign(new Error("blob unavailable"), { status: 404 }); } }
  } as unknown as Octokit;
  await assert.rejects(loadArtifact(client, "owner", "repo", "issues-map.json", "__STORAGE__"), /blob unavailable/);
});
