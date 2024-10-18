import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue, octokit } from "./directory/directory";
import { Statistics } from "./directory/statistics";
let gitChanges: Array<{ path: string; content: string }> = [];

async function gitCommit(data: unknown, fileName: string) {
  try {
    gitChanges.push({
      path: fileName,
      content: JSON.stringify(data),
    });
  } catch (error) {
    console.error(`Error stringifying data for ${fileName}:`, error);
    throw error;
  }
}

import { Octokit } from "@octokit/rest";
import { TwitterMap } from "./twitter/initialize-twitter-map";

const MAX_PAYLOAD_SIZE = 100000000; // 100MB per commit, adjust as needed

export async function gitPush() {
  if (gitChanges.length === 0) {
    console.log("No changes to commit");
    return;
  }

  try {
    const owner = DEVPOOL_OWNER_NAME;
    const repo = DEVPOOL_REPO_NAME;
    const branch = "__STORAGE__"; // Special branch for automated data updates
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const latestCommitSha = refData.object.sha;

    let currentChanges: Array<{ path: string; content: string }> = [];
    let currentSize = 0;

    for (const change of gitChanges) {
      const changeSize = Buffer.byteLength(change.content, "utf8");
      if (currentSize + changeSize > MAX_PAYLOAD_SIZE) {
        await commitChanges(octokit, owner, repo, branch, latestCommitSha, currentChanges);
        currentChanges = [];
        currentSize = 0;
      }
      currentChanges.push(change);
      currentSize += changeSize;
    }

    if (currentChanges.length > 0) {
      await commitChanges(octokit, owner, repo, branch, latestCommitSha, currentChanges);
    }

    // Clear the changes after successful push
    gitChanges = [];
  } catch (error) {
    console.error("Error committing changes:", error);
    throw error;
  }
}

async function commitChanges(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  baseSha: string,
  changes: Array<{ path: string; content: string }>
) {
  if (changes.length === 0) return;

  // Create tree for the changes
  const { data: treeData } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseSha,
    tree: changes.map((change) => ({
      path: change.path,
      mode: "100644",
      type: "blob",
      content: change.content,
    })),
  });

  // Create commit
  const { data: commitData } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: "chore: update files",
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

  console.log(`Committed to ${branch}: ${commitData.sha}`);
}

export async function commitStatistics(statistics: Statistics) {
  try {
    await gitCommit(statistics, "devpool-statistics.json");
  } catch (error) {
    console.error(`Error preparing devpool statistics for github file: ${error}`);
  }
}

export async function commitTasks(tasks: GitHubIssue[]) {
  try {
    await gitCommit(tasks, "devpool-issues.json");
  } catch (error) {
    console.error(`Error preparing devpool issues for github file: ${error}`);
  }
}

export async function commitTwitterMap(twitterMap: TwitterMap) {
  try {
    await gitCommit(twitterMap, "twitter-map.json");
  } catch (error) {
    console.error(`Error preparing twitter map for github file: ${error}`);
  }
}
