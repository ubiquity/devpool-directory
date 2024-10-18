import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue, octokit, StateChanges } from "./directory";
import { getIssueLabelValue } from "./get-issue-label-value";

export async function setStateChanges(directoryIssues: GitHubIssue[], directoryIssue: GitHubIssue, partnerIssue: GitHubIssue) {
  const stateChanges: StateChanges = {
    // missing in the partners
    forceMissing_Close: {
      cause: !directoryIssues.some((projectIssue) => projectIssue.node_id === getIssueLabelValue(partnerIssue, "id:")),
      effect: "closed",
      comment: "Closed (missing in partners)",
    },
    // it's closed, been merged and still open in the Directory
    issueComplete_Close: {
      cause: directoryIssue.state === "closed" && partnerIssue.state === "open" && !!directoryIssue.pull_request?.merged_at,
      effect: "closed",
      comment: "Closed (merged)",
    },
    // it's closed, assigned and still open in the Directory
    issueAssignedClosed_Close: {
      cause: directoryIssue.state === "closed" && partnerIssue.state === "open" && !!directoryIssue.assignee?.login,
      effect: "closed",
      comment: "Closed (assigned-closed)",
    },
    // it's closed, not merged and still open in the Directory
    issueClosed_Close: {
      cause: directoryIssue.state === "closed" && partnerIssue.state === "open",
      effect: "closed",
      comment: "Closed (not merged)",
    },
    // it's open, assigned and still open in the Directory
    issueAssignedOpen_Close: {
      cause: directoryIssue.state === "open" && partnerIssue.state === "open" && !!directoryIssue.assignee?.login,
      effect: "closed",
      comment: "Closed (assigned-open)",
    },
    // it's open, merged, unassigned and is closed in the Directory
    issueReopenedMerged_Open: {
      cause: directoryIssue.state === "open" && partnerIssue.state === "closed" && !!directoryIssue.pull_request?.merged_at && !directoryIssue.assignee?.login,
      effect: "open",
      comment: "Reopened (merged)",
    },
    // it's open, unassigned and is closed in the Directory
    issueUnassigned_Open: {
      cause: directoryIssue.state === "open" && partnerIssue.state === "closed" && !directoryIssue.assignee?.login,
      effect: "open",
      comment: "Reopened (unassigned)",
    },
  };

  let newState: "open" | "closed" | undefined = undefined;

  for (const value of Object.values(stateChanges)) {
    // if the cause is true and the effect is different from the current state
    if (value.cause && partnerIssue.state != value.effect) {
      // if the new state is already set, then skip it
      if (newState && newState === value.effect) {
        continue;
      }

      try {
        await octokit.rest.issues.update({
          owner: DEVPOOL_OWNER_NAME,
          repo: DEVPOOL_REPO_NAME,
          issue_number: partnerIssue.number,
          state: value.effect,
        });
        console.log(`Updated state: (${value.comment})\n${partnerIssue.html_url} - (${directoryIssue.html_url})`);
        newState = value.effect;
      } catch (err) {
        console.log(err);
      }
    }
  }

  return newState;
}
