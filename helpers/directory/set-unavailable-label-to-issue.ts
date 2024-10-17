import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue, GitHubLabel, LABELS, octokit } from "./directory";

export async function setUnavailableLabelToIssue(
  projectIssue: GitHubIssue,
  devpoolIssue: GitHubIssue,
  metaChanges: { labels: boolean },
  labelRemoved: string[],
  originals: string[],
  newState: "open" | "closed"
) {
  // Apply the "Unavailable" label to the devpool issue if the project issue is assigned to someone
  if (
    // only if the devpool issue is closed
    (newState === "closed" || devpoolIssue.state === "closed") &&
    // only if project issue is open
    projectIssue.state === "open" &&
    // only if the project issue is assigned to someone
    projectIssue.assignee?.login &&
    // only if the devpool issue doesn't have the "Unavailable" label
    !devpoolIssue.labels.some((label) => (label as GitHubLabel).name === LABELS.UNAVAILABLE)
  ) {
    try {
      await octokit.rest.issues.addLabels({
        owner: DEVPOOL_OWNER_NAME,
        repo: DEVPOOL_REPO_NAME,
        issue_number: devpoolIssue.number,
        labels: metaChanges.labels ? labelRemoved.concat(LABELS.UNAVAILABLE) : originals.concat(LABELS.UNAVAILABLE),
      });
    } catch (err) {
      console.log(err);
    }
  } else if (projectIssue.state === "closed" && devpoolIssue.labels.some((label) => (label as GitHubLabel).name === LABELS.UNAVAILABLE)) {
    try {
      await octokit.rest.issues.removeLabel({
        owner: DEVPOOL_OWNER_NAME,
        repo: DEVPOOL_REPO_NAME,
        issue_number: devpoolIssue.number,
        name: LABELS.UNAVAILABLE,
      });

      console.log(`Removed label: ${LABELS.UNAVAILABLE}\n${devpoolIssue.html_url} - (${projectIssue.html_url})`);
    } catch (err) {
      console.log(err);
    }
  }
}
