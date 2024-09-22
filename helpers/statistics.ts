import { Statistics } from "../types/statistics";
import { GitHubIssue, GitHubLabel } from "../types/github";
import { getIssueLabelValue } from "./issue";
import { getProjectMap } from "./get-project-map";
import { DEVPOOL_REPO_NAME, DEVPOOL_OWNER_NAME, octokit } from "./constants";

// Function to calculate total rewards and tasks statistics
export async function calculateStatistics(devpoolIssues: GitHubIssue[], projectMap: Awaited<ReturnType<typeof getProjectMap>>) {
  const rewards = { notAssigned: 0, assigned: 0, completed: 0, total: 0 };
  const tasks = { notAssigned: 0, assigned: 0, completed: 0, total: 0 };

  devpoolIssues.forEach((devpoolIssue) => {
    if (!devpoolIssue.repository_url || !devpoolIssue.html_url) return;

    const isFromDevpool = devpoolIssue.repository_url.includes(DEVPOOL_REPO_NAME) && devpoolIssue.html_url.includes(DEVPOOL_REPO_NAME);
    if (!isFromDevpool) return;

    const partnerTaskId = getIssueLabelValue(devpoolIssue, "id:");
    if (!partnerTaskId) {
      console.error(`This is probably an unofficial bot post:  ${devpoolIssue.html_url}`);
      return;
    }

    const task = projectMap.get(partnerTaskId || "");
    if (!task) {
      console.error(`Project ${partnerTaskId} not found in partner tasks: likely an unofficial bot issue`);
      return;
    }

    let price = calculatePrice(task.labels as GitHubLabel[]);

    if (isNaN(price) || price < 0) {
      console.error(`Invalid price for task ${task.html_url} - ${devpoolIssue.html_url}`);
      price = 0;
    }

    // open in both and not assigned
    const isOpen = task.state === "open" && devpoolIssue.state === "open";
    // open only in partner and is assigned
    const isAssigned = task.state === "open" && devpoolIssue.state === "closed";
    const isCompleted = task.state === "closed" && devpoolIssue.state === "closed" && task.state_reason && task.state_reason !== "not_planned";

    // tally all totals
    tasks.total++;
    rewards.total += price;

    // tally all others rewards and tasks from
    // repos which are not excluded
    if (isOpen) {
      rewards.notAssigned += price;
      tasks.notAssigned++;
    } else if (isAssigned) {
      rewards.assigned += price;
      tasks.assigned++;
    } else if (isCompleted) {
      rewards.completed += price;
      tasks.completed++;
    }
  });

  return { rewards, tasks };
}

function calculatePrice(devpoolLabels: GitHubLabel[]): number {
  const priceLabel = devpoolLabels.find(
    (label) => (typeof label === "string" ? label : label.name).includes("Price:") || (typeof label === "string" ? label : label.name).includes("Pricing")
  );
  return priceLabel ? parseInt((priceLabel.name as string).split(" ")[1].trim(), 10) : 0;
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
