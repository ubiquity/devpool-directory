import { GitHubIssue, GitHubLabel, LABELS, PRICING_NOT_SET, projects } from "./directory";
import { getIssuePriceLabel } from "./get-issue-price-label";

/**
 * Returns array of labels for a devpool issue
 * @param issue issue object
 * @param projectUrl url of the project
 */

export function getDirectoryIssueLabels(remoteIssue: GitHubIssue, projectUrl: string) {
  // get owner and repo name from issue's URL because the repo name could be updated

  const pricing = getIssuePriceLabel(remoteIssue);

  let buffer: string[];

  // default labels
  if (pricing != PRICING_NOT_SET) {
    buffer = [
      pricing,
      `id: ${remoteIssue.node_id}`, // id
    ];
  } else {
    buffer = [
      `id: ${remoteIssue.node_id}`, // id
    ];
  }

  // if project is already assigned then add the "Unavailable" label
  if (remoteIssue.assignee?.login) buffer.push(LABELS.UNAVAILABLE);

  const labels = remoteIssue.labels as GitHubLabel[];
  // add all missing labels that exist in a project's issue and don't exist in devpool issue
  for (const projectIssueLabel of labels) {
    // add all missing labels that exist in a project's issue and don't exist in devpool issue
    if (projectIssueLabel.name.includes("Price")) continue; // skip the "Price" label in order to not accidentally generate a permit
    if (!buffer.includes(projectIssueLabel.name)) buffer.push(projectIssueLabel.name); // if project issue label does not exist in devpool issue then add it
  }
  if (projects.category && projectUrl in projects.category) buffer.push(projects.category[projectUrl]); // if project category for the project is defined, add its category label
  return buffer;
}
