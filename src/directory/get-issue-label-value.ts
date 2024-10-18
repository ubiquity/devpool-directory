import { GitHubIssue, GitHubLabel } from "./directory";

/**
 * Returns label value by label prefix
 * Example: "Partner: my/repo" => "my/repo"
 * Example: "id: 123qwe" => "123qwe"
 * @param issue issue
 * @param labelPrefix label prefix
 */

export function getIssueLabelValue(issue: GitHubIssue, labelPrefix: string) {
  let labelValue = null;
  const labels = issue.labels as GitHubLabel[];
  for (const labelObj of labels) {
    if (labelObj.name.includes(labelPrefix)) {
      labelValue = labelObj.name.split(":")[1].trim();
      break;
    }
  }
  return labelValue;
}
