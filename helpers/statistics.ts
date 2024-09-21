import { Statistics } from "../types/statistics";
import optInOptOut from "../opt.json";
import { GitHubIssue, GitHubLabel, LABELS } from "../types/github";
import { DEVPOOL_REPO_NAME, DEVPOOL_OWNER_NAME, octokit } from "./github";

// Function to calculate total rewards and tasks statistics
export async function calculateStatistics(devpoolIssues: GitHubIssue[]) {
  const rewards = {
    notAssigned: 0,
    assigned: 0,
    completed: 0,
    total: 0,
  };

  const tasks = {
    notAssigned: 0,
    assigned: 0,
    completed: 0,
    total: 0,
  };

  devpoolIssues.forEach((issue) => {
    if (!issue.repository_url || !issue.html_url) return;
    if (!issue.repository_url.includes(DEVPOOL_REPO_NAME) || !issue.html_url.includes(DEVPOOL_REPO_NAME)) return;
    if ("repo" in issue && issue.repo != DEVPOOL_REPO_NAME) return;

    const linkedRepoFromBody = issue.body?.match(/https:\/\/github.com\/[^/]+\/[^/]+/);
    const linkedRepoFromBodyAlt = issue.body?.match(/https:\/\/www.github.com\/[^/]+\/[^/]+/);

    let shouldExclude = optInOptOut.out.some((orgOrRepo) => linkedRepoFromBody?.[0].includes(orgOrRepo));
    shouldExclude = shouldExclude || optInOptOut.out.some((orgOrRepo) => linkedRepoFromBodyAlt?.[0].includes(orgOrRepo));

    const labels = issue.labels as GitHubLabel[];
    // devpool issue has unavailable label because it's assigned and so it's closed
    const isAssigned = labels.find((label) => (label.name as string).includes(LABELS.UNAVAILABLE)) && issue.state === "closed";
    // devpool issue doesn't have unavailable label because it's unassigned and closed so it's merged therefore completed
    const isCompleted = !labels.some((label) => (label.name as string).includes(LABELS.UNAVAILABLE)) && issue.state === "closed";
    const isOpen = issue.state === "open";
    const priceLabel = labels.find((label) => (label.name as string).includes("Pricing"));
    const price = priceLabel ? parseInt((priceLabel.name as string).split(":")[1].trim(), 10) : 0;

    if (isOpen && !shouldExclude) {
      rewards.notAssigned += !isNaN(price) ? price : 0;
      tasks.notAssigned++;
      tasks.total++;
      rewards.total += !isNaN(price) ? price : 0;
    } else if (isAssigned && !shouldExclude) {
      rewards.assigned += !isNaN(price) ? price : 0;
      tasks.assigned++;
      tasks.total++;
      rewards.total += !isNaN(price) ? price : 0;
    } else if (isCompleted) {
      rewards.completed += !isNaN(price) ? price : 0;
      tasks.completed++;
      tasks.total++;
      rewards.total += !isNaN(price) ? price : 0;
    } else {
      console.error(`Issue ${issue.number} is not assigned, not completed and not open`);
    }
  });

  return { rewards, tasks };
}

export async function writeTotalRewardsToGithub(statistics: Statistics) {
  try {
    const owner = DEVPOOL_OWNER_NAME;
    const repo = DEVPOOL_REPO_NAME;
    const filePath = "total-rewards.json";
    const content = JSON.stringify(statistics, null, 2);

    let sha: string | undefined; // Initialize sha to undefined

    // Get the SHA of the existing file, if it exists
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: filePath,
      });

      if (!Array.isArray(data)) {
        // File exists
        sha = data.sha;
      }
    } catch (error) {
      // File doesn't exist yet
      console.log(`File ${filePath} doesn't exist yet.`);
    }

    // Update or create the file
    await octokit.rest.repos
      .createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: "Update total rewards",
        content: Buffer.from(content).toString("base64"),
        sha, // Pass the SHA if the file exists, to update it
      })
      .catch((error) => {
        console.error(`Error updating total rewards: ${error}`);
      });

    console.log(`Total rewards written to ${filePath}`);
  } catch (error) {
    console.error(`Error writing total rewards to github file: ${error}`);
    throw error;
  }
}
