import { GitHubIssue, GitHubLabel } from "./directory";

/**
 * Returns issue by label
 * @param issues issues array
 * @param label label string
 */

export function getIssueByLabel(issues: GitHubIssue[], label: string) {
  issues = issues.filter((issue) => {
    const labels = (issue.labels as GitHubLabel[]).filter((obj) => obj.name === label);
    return labels.length > 0;
  });
  return issues.length > 0 ? issues[0] : null;
}
