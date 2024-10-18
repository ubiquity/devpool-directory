import { GitHubIssue, GitHubLabel } from "./directory";

/**
 * Returns text for social media (twitter, telegram, etc...)
 * @param issue Github issue data
 * @returns Social media text
 * Example:
 * ```
 * 50 USD for <1 Hour
 *
 * https://github.com/ubiquity/pay.ubq.fi/issues/65
 * ```
 */

export function getSocialMediaText(issue: GitHubIssue): string {
  const labels = issue.labels as GitHubLabel[];
  const priceLabel = labels.find((label) => label.name.includes("Pricing: "))?.name.replace("Pricing: ", "");
  const timeLabel = labels.find((label) => label.name.includes("Time: "))?.name.replace("Time: ", "");
  // `issue.body` contains URL to the original issue in partner's project
  // while `issue.html_url` contains URL to the mirrored issue from the devpool directory
  return `${priceLabel} for ${timeLabel}\n\n${issue.body}`;
}
