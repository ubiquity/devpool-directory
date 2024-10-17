import optInOptOut from "../../opt.json";
import { DEVPOOL_REPO_NAME, GitHubIssue, GitHubLabel, LABELS } from "./directory";
import NetworkStatistics from "../../devpool-statistics.json";

// Calculates statistics for DevPool issues.
export async function calculateStatistics(directoryIssues: GitHubIssue[]) {
  const statistics: typeof NetworkStatistics = {
    rewards: { notAssigned: 0, assigned: 0, completed: 0, total: 0 },
    tasks: { notAssigned: 0, assigned: 0, completed: 0, total: 0 },
  };

  directoryIssues.forEach((issue) => {
    if (!isValidDirectoryIssue(issue)) return;
    const { isOptOut, taskStatus, price } = analyzeIssue(issue);
    if (isOptOut && taskStatus !== TaskStatus.Completed) return;
    updateStatistics(statistics, taskStatus, price);
  });

  return statistics;
}

function isValidDirectoryIssue(issue: GitHubIssue): boolean {
  if (!issue.repository_url || !issue.html_url) return false;
  if (!issue.repository_url.includes(DEVPOOL_REPO_NAME) || !issue.html_url.includes(DEVPOOL_REPO_NAME)) return false;
  if ("repo" in issue && issue.repo !== DEVPOOL_REPO_NAME) return false;
  return true;
}

// Analyzes an issue to determine its status, price, and whether it should be excluded.
function analyzeIssue(issue: GitHubIssue) {
  if (!issue.body) {
    return {
      isOptOut: false,
      taskStatus: TaskStatus.NotAssigned,
      price: 0,
    };
  }
  const linkedRepo = extractLinkedRepo(issue.body);
  const isOptOut = optInOptOut.out.some((orgOrRepo) => linkedRepo?.includes(orgOrRepo));
  const labels = issue.labels as GitHubLabel[]; // Type assertion needed because the GitHub API does not return the correct type.
  const taskStatus = determineTaskStatus(issue, labels);
  const price = extractPrice(labels);

  return { isOptOut, taskStatus, price };
}

// Extracts the linked repository URL from the issue body.
function extractLinkedRepo(body?: string): string | undefined {
  const match = body?.match(/https:\/\/(www\.)?github.com\/[^/]+\/[^/]+/);
  return match?.[0];
}

// Determines the status of an issue based on its state and labels.
function determineTaskStatus(issue: GitHubIssue, labels: GitHubLabel[]): TaskStatus {
  const isUnavailable = labels.some((label) => (label.name as string).includes(LABELS.UNAVAILABLE)); // Assigned already
  if (issue.state === "open") return TaskStatus.NotAssigned;
  if (isUnavailable) return TaskStatus.Assigned;
  return TaskStatus.Completed;
}

// Extracts the price from the issue labels.
function extractPrice(labels: GitHubLabel[]): number {
  const priceLabel = labels.find((label) => (label.name as string).includes("Pricing"));
  const priceString = priceLabel ? (priceLabel.name as string).split(":")[1].trim() : "0";
  return parseInt(priceString, 10) || 0;
}

// Updates the statistics object with the given status and price.
function updateStatistics(statistics: typeof NetworkStatistics, status: TaskStatus, price: number) {
  statistics.rewards[status] += price;
  statistics.tasks[status]++;
  statistics.rewards.total += price;
  statistics.tasks.total++;
}

// Enum representing the possible statuses of a task.
enum TaskStatus {
  NotAssigned = "notAssigned",
  Assigned = "assigned",
  Completed = "completed",
}
