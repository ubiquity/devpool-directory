import { GitHubIssue, GitHubLabel, PRICING_NOT_SET } from "./directory";

/**
 * Returns price label from an issue
 * @param issue issue object
 * @returns price label
 */

export function getIssuePriceLabel(issue: GitHubIssue) {
  const defaultPriceLabel = PRICING_NOT_SET;
  const labels = issue.labels as GitHubLabel[];
  const priceLabels = labels.filter((label) => label.name.includes("Price:") || label.name.includes("Pricing:"));
  // NOTICE: we rename "Price" to "Pricing" because the bot removes all manually added price labels starting with "Price:"
  return priceLabels.length > 0 ? priceLabels[0].name.replace("Price", "Pricing") : defaultPriceLabel;
}
