import { TwitterMap } from "..";
import { Statistics } from "../types/statistics";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue, octokit } from "./github";
let gitChanges: Array<{ path: string; content: string }> = [];

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  try {
    const { data } = await octokit.rest.repos.get({
      owner,
      repo,
    });
    return data.default_branch;
  } catch (error) {
    console.error(`Error fetching default branch: ${error}`);
    throw error;
  }
}

import { stringify } from "flatted";

async function gitCommit(data: unknown, fileName: string) {
  try {
    const content = stringify(data, undefined, 2);
    gitChanges.push({
      path: `${fileName}.json`,
      content: content,
    });
  } catch (error) {
    console.error(`Error stringifying data for ${fileName}:`, error);
    throw error;
  }
}

import { Octokit } from "@octokit/rest";

const MAX_PAYLOAD_SIZE = 100000000; // 100MB per commit, adjust as needed

export async function gitPush() {
  if (gitChanges.length === 0) {
    console.log("No changes to commit");
    return;
  }

  try {
    if (!process.env.GH_TOKEN) {
      throw new Error("GH_TOKEN environment variable is not set");
    }
    const octokit = new Octokit({ auth: process.env.GH_TOKEN });
    const owner = DEVPOOL_OWNER_NAME;
    const repo = DEVPOOL_REPO_NAME;
    const branch = await getDefaultBranch(owner, repo);
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const latestCommitSha = refData.object.sha;

    let currentBatch: Array<{ path: string; content: string }> = [];
    let currentSize = 0;

    for (const change of gitChanges) {
      const changeSize = Buffer.byteLength(change.content, "utf8");
      if (currentSize + changeSize > MAX_PAYLOAD_SIZE) {
        await commitBatch(octokit, owner, repo, branch, latestCommitSha, currentBatch);
        currentBatch = [];
        currentSize = 0;
      }
      currentBatch.push(change);
      currentSize += changeSize;
    }

    if (currentBatch.length > 0) {
      await commitBatch(octokit, owner, repo, branch, latestCommitSha, currentBatch);
    }

    // Clear the batched changes after successful push
    gitChanges = [];
  } catch (error) {
    console.error("Error committing batched changes:", error);
    throw error;
  }
}

async function commitBatch(octokit: Octokit, owner: string, repo: string, branch: string, baseSha: string, batch: Array<{ path: string; content: string }>) {
  if (batch.length === 0) return;

  // Create tree for the batch
  const { data: treeData } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseSha,
    tree: batch.map((change) => ({
      path: change.path,
      mode: "100644",
      type: "blob",
      content: change.content,
    })),
  });

  // Create commit for the batch
  const { data: commitData } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: "chore: update files (batch)",
    tree: treeData.sha,
    parents: [baseSha],
  });

  // Update the reference to point to the new commit
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commitData.sha,
  });

  console.log(`Committed batch to ${branch}: ${commitData.sha}`);
}

export async function commitRewards(statistics: Statistics) {
  try {
    await gitCommit(statistics, "total-rewards");
  } catch (error) {
    console.error(`Error preparing total rewards for github file: ${error}`);
  }
}

export async function commitTasks(tasks: GitHubIssue[]) {
  try {
    await gitCommit(tasks, "total-tasks");
  } catch (error) {
    console.error(`Error preparing total tasks for github file: ${error}`);
  }
}

export async function commitTwitterMap(twitterMap: TwitterMap) {
  try {
    await gitCommit(twitterMap, "twitter-map");
  } catch (error) {
    console.error(`Error preparing twitter map for github file: ${error}`);
  }
}
