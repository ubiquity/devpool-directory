import { isTaskPriced } from "../helpers/issue";
import { getRepoCredentials } from "../helpers/repos";
import { GitHubIssue } from "../types/github";
import { applyMetaChanges, applyStateChanges } from "./state-updates";

export async function handleDevPoolIssue(
  missingInPartners: boolean,
  projectIssue: GitHubIssue,
  devpoolIssue: GitHubIssue,
  isFork: boolean
) {
  const devpoolLabels = devpoolIssue.labels.map((label) => (typeof label === "string" ? label : label.name)).filter((label): label is string => label !== null);

  // Filter out 'id' and 'Partner' labels and store separately
  const filteredLabels = devpoolLabels.filter((label) => !label.includes("id:") && !label.includes("Partner:"));
  let idAndPartnerLabels = devpoolLabels.filter((label) => label.includes("id:") || label.includes("Partner:"));
  const idLabel = `id: ${projectIssue.node_id}`;

  if (!idAndPartnerLabels.includes(idLabel)) {
    const [owner, repo] = getRepoCredentials(projectIssue.html_url);
    const partnerLabel = `Partner: ${owner}/${repo}`;
    idAndPartnerLabels = [idLabel, partnerLabel];
  }

  const hasPriceLabel = isTaskPriced(projectIssue);

  // Normalize price label if present
  let updatedLabels = hasPriceLabel ? filteredLabels.map((label) => label.replace("Pricing:", "Price:")) : filteredLabels;

  // Check for label changes by comparing devpool labels with project issue labels
  const hasLabelChanges = projectIssue.labels.some((label) => {
    const labelName = typeof label === "string" ? label : label.name;
    return labelName && !updatedLabels.includes(labelName);
  });

  if (!hasLabelChanges) {
    updatedLabels = devpoolLabels; // No changes, revert to original labels
  } else {
    const projectLabels = projectIssue.labels
      .map((label) => (typeof label === "string" ? label : label.name))
      .filter((label): label is string => label !== null);

    // Merge project labels with id/partner labels if there are changes
    updatedLabels = [...projectLabels, ...idAndPartnerLabels];

    console.log("Labels need update:", {
      devpoolLabels,
      projectLabels: projectIssue.labels.map((label) => (typeof label === "string" ? label : label.name)),
    });
  }

  // Determine if body requires updating
  const projectUrlForComparison = isFork ? projectIssue.html_url.replace("https://", "https://www.") : projectIssue.html_url;
  const shouldUpdateBody = devpoolIssue.body !== projectUrlForComparison;
  const hasTitleChanges = devpoolIssue.title !== projectIssue.title;

  if (shouldUpdateBody) {
    console.log("Body needs update:", {
      isFork,
      devpoolIssueUrl: devpoolIssue.html_url,
      projectIssueUrl: projectIssue.html_url,
      devpoolBody: devpoolIssue.body,
    });
  }

  if (hasTitleChanges) {
    console.log("Title needs update:", {
      devpoolTitle: devpoolIssue.title,
      projectTitle: projectIssue.title,
    });
  }

  const metaChanges = {
    title: hasTitleChanges,
    body: shouldUpdateBody,
    labels: hasLabelChanges,
  };

  await applyMetaChanges(metaChanges, devpoolIssue, projectIssue, isFork, updatedLabels);
  await applyStateChanges(missingInPartners, projectIssue, devpoolIssue, hasPriceLabel);
}
