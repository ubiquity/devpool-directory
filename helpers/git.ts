import { TwitterMap } from "..";
import { Statistics } from "../types/statistics";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue, octokit } from "./github";
// Add these new variables and modify batchedChanges if not already present
let gitChanges: { path: string; content: string }[] = [];

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  // Function to get the default branch of the repository
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

// Replace the existing writeJsonToGithub function with this:
async function gitCommit(data: unknown, fileName: string) {
  const filePath = `${fileName}.json`;
  const content = JSON.stringify(data, null, 2);

  gitChanges.push({
    path: filePath,
    content: content,
  });
}

// Add this new function to perform the batched commit:
export async function gitPush() {
  if (gitChanges.length === 0) {
    console.log("No changes to commit");
    return;
  }

  try {
    const owner = DEVPOOL_OWNER_NAME;
    const repo = DEVPOOL_REPO_NAME;

    // Dynamically get the default branch
    const branch = await getDefaultBranch(owner, repo);

    // Get the latest commit SHA
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const latestCommitSha = refData.object.sha;

    // Create a new tree with the batched changes
    const { data: treeData } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: latestCommitSha,
      tree: gitChanges.map((change) => ({
        path: change.path,
        mode: "100644",
        type: "blob",
        content: change.content,
      })),
    });

    const { data: commitData } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: "chore: update files",
      tree: treeData.sha,
      parents: [latestCommitSha],
    });

    // Update the reference to point to the new commit
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commitData.sha,
    });

    console.log(`Batched changes committed to ${branch}: ${commitData.sha}`);

    // Clear the batched changes
    gitChanges = [];
  } catch (error) {
    console.error("Error committing batched changes:", error);
  }
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
