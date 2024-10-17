import { GitHubIssue, GitHubLabel, LABELS, PRICING_NOT_SET, projects } from "./directory";
import { getIssuePriceLabel } from "./get-issue-price-label";

export function getDirectoryIssueLabelsFromPartnerIssue(partnerIssue: GitHubIssue) {
  const buffer: string[] = [`id: ${partnerIssue.node_id}`];
  const pricing = getIssuePriceLabel(partnerIssue);

  if (pricing != PRICING_NOT_SET) {
    buffer.push(pricing);
  }

  // if project is already assigned then add the "Unavailable" label
  if (partnerIssue.assignees && partnerIssue.assignees.length > 0) {
    buffer.push(LABELS.UNAVAILABLE);
  }

  const partnerIssueLabels = partnerIssue.labels as GitHubLabel[];
  // add all missing labels that exist in a project's issue and don't exist in Directory issue
  for (const label of partnerIssueLabels) {
    // add all missing labels that exist in a project's issue and don't exist in Directory issue
    if (label.name.includes("Price")) continue; // skip the "Price" label in order to not accidentally generate a permit
    if (!buffer.includes(label.name)) buffer.push(label.name); // if project issue label does not exist in Directory issue then add it
  }
  if (projects.category && partnerIssue.html_url in projects.category) buffer.push(projects.category[partnerIssue.html_url]); // if project category for the project is defined, add its category label
  return buffer;
}
