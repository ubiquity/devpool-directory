import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue, GitHubLabel, LABELS, octokit } from "./directory";

export async function setUnavailableLabelToIssue({
  directoryIssue,
  partnerIssue,
  metaChanges,
  labelRemoved,
  originals,
}: {
  directoryIssue: GitHubIssue;
  partnerIssue: GitHubIssue;
  metaChanges: { labels: boolean };
  labelRemoved: string[];
  originals: string[];
}) {
  // console.trace({ directoryIssue });

  const hasUnavailableLabel = directoryIssue.labels.some((label) => (label as GitHubLabel).name === LABELS.UNAVAILABLE);
  const isProjectAssigned = !!partnerIssue.assignee?.login;
  const isProjectOpen = partnerIssue.state === "open";
  console.log(`Issue #${partnerIssue.number} | State: ${directoryIssue.state} | Assigned: ${isProjectAssigned} | Unavailable: ${hasUnavailableLabel}`);

  // Apply the "Unavailable" label to the devpool issue if the project issue is open and assigned
  if (isProjectOpen && isProjectAssigned && !hasUnavailableLabel) {
    try {
      await octokit.rest.issues.addLabels({
        owner: DEVPOOL_OWNER_NAME,
        repo: DEVPOOL_REPO_NAME,
        issue_number: directoryIssue.number,
        labels: metaChanges.labels ? labelRemoved.concat(LABELS.UNAVAILABLE) : originals.concat(LABELS.UNAVAILABLE),
      });
      console.log(`Added label "${LABELS.UNAVAILABLE}" to Issue #${directoryIssue.number}`);
    } catch (err) {
      console.error(`Error adding label to Issue #${directoryIssue.number}:`, err);
    }
  }
  // Remove the "Unavailable" label if the project issue is closed
  else if (partnerIssue.state === "closed" && hasUnavailableLabel) {
    try {
      await octokit.rest.issues.removeLabel({
        owner: DEVPOOL_OWNER_NAME,
        repo: DEVPOOL_REPO_NAME,
        issue_number: directoryIssue.number,
        name: LABELS.UNAVAILABLE,
      });

      console.log(`Removed label "${LABELS.UNAVAILABLE}" from Issue #${directoryIssue.number}`);
    } catch (err) {
      console.error(`Error removing label from Issue #${directoryIssue.number}:`, err);
    }
  }
}
