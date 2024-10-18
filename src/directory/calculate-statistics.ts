import optInOptOut from "../../opt.json";
import { DEVPOOL_REPO_NAME, GitHubIssue, GitHubLabel, Labels } from "./directory";

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
    const linkedRepoFromBodyForked = issue.body?.match(/https:\/\/www.github.com\/[^/]+\/[^/]+/);

    let shouldExclude = optInOptOut.out.some((orgOrRepo) => linkedRepoFromBody?.[0].includes(orgOrRepo));
    shouldExclude = shouldExclude || optInOptOut.out.some((orgOrRepo) => linkedRepoFromBodyForked?.[0].includes(orgOrRepo));

    const labels = issue.labels as GitHubLabel[];
    // devpool issue has unavailable label because it's assigned and so it's closed
    const isAssigned = labels.find((label) => (label.name as string).includes(Labels.UNAVAILABLE)) && issue.state === "closed";
    // devpool issue doesn't have unavailable label because it's unassigned and closed so it's merged therefore completed
    const isCompleted = !labels.some((label) => (label.name as string).includes(Labels.UNAVAILABLE)) && issue.state === "closed";
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
