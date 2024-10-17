import { GitHubIssue, GitHubLabel, LABELS, PRICING_NOT_SET, projects } from "./directory";
import { getIssuePriceLabel } from "./get-issue-price-label";
import { getRepoCredentials } from "./get-repo-credentials";

/**
 * Returns array of labels for a devpool issue
 * @param issue issue object
 * @param projectUrl url of the project
 */

export function getDirectoryIssueLabels(issue: GitHubIssue, projectUrl: string) {
  // get owner and repo name from issue's URL because the repo name could be updated
  const [ownerName, repoName] = getRepoCredentials(issue.html_url);

  const pricing = getIssuePriceLabel(issue);

  let devpoolIssueLabels: string[];

  // default labels
  if (pricing != PRICING_NOT_SET) {
    devpoolIssueLabels = [
      pricing,
      `Partner: ${ownerName}/${repoName}`,
      `id: ${issue.node_id}`, // id
    ];
  } else {
    devpoolIssueLabels = [
      `Partner: ${ownerName}/${repoName}`,
      `id: ${issue.node_id}`, // id
    ];
  }

  // if project is already assigned then add the "Unavailable" label
  if (issue.assignee?.login) devpoolIssueLabels.push(LABELS.UNAVAILABLE);

  const labels = issue.labels as GitHubLabel[];

  // add all missing labels that exist in a project's issue and don't exist in devpool issue
  for (const projectIssueLabel of labels) {
    // skip the "Price" label in order to not accidentally generate a permit
    if (projectIssueLabel.name.includes("Price")) continue;
    // if project issue label does not exist in devpool issue then add it
    if (!devpoolIssueLabels.includes(projectIssueLabel.name)) devpoolIssueLabels.push(projectIssueLabel.name);
  }

  // if project category for the project is defined, add its category label
  if (projects.category && projectUrl in projects.category) devpoolIssueLabels.push(projects.category[projectUrl]);

  return devpoolIssueLabels;
}
