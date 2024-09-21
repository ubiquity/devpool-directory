import { octokit, DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME } from "../helpers/github";
import { getIssueLabelValue } from "../helpers/issue";
import { GitHubIssue, StateChanges } from "../types/github";

export async function applyMetaChanges(
    metaChanges: { title: boolean; body: boolean; labels: boolean },
    devpoolIssue: GitHubIssue,
    projectIssue: GitHubIssue,
    isFork: boolean,
    labelRemoved: string[],
    originals: string[]
) {
    const shouldUpdate = metaChanges.title || metaChanges.body || metaChanges.labels;

    if (shouldUpdate) {
        let newBody = devpoolIssue.body;

        if (metaChanges.body && !isFork) {
            newBody = projectIssue.html_url;
        } else {
            newBody = projectIssue.html_url.replace("https://", "https://www.");
        }

        try {
            await octokit.rest.issues.update({
                owner: DEVPOOL_OWNER_NAME,
                repo: DEVPOOL_REPO_NAME,
                issue_number: devpoolIssue.number,
                title: metaChanges.title ? projectIssue.title : devpoolIssue.title,
                body: newBody,
                labels: metaChanges.labels ? labelRemoved : originals,
            });
        } catch (err) {
            console.error(err);
        }

        console.log(`Updated metadata: ${devpoolIssue.html_url} - (${projectIssue.html_url})`, metaChanges);
    }
}

export async function applyStateChanges(projectIssues: GitHubIssue[], projectIssue: GitHubIssue, devpoolIssue: GitHubIssue, hasNoPriceLabels: boolean) {
    const stateChanges: StateChanges = {
        // missing in the partners
        forceMissing_Close: {
            cause: !projectIssues.some((projectIssue) => projectIssue.node_id === getIssueLabelValue(devpoolIssue, "id:")),
            effect: "closed",
            comment: "Closed (missing in partners)",
        },
        // no price labels set and open in the devpool
        noPriceLabels_Close: {
            cause: hasNoPriceLabels && devpoolIssue.state === "open",
            effect: "closed",
            comment: "Closed (no price labels)",
        },
        // it's closed, been merged and still open in the devpool
        issueComplete_Close: {
            cause: projectIssue.state === "closed" && devpoolIssue.state === "open" && !!projectIssue.pull_request?.merged_at,
            effect: "closed",
            comment: "Closed (merged)",
        },
        // it's closed, assigned and still open in the devpool
        issueAssignedClosed_Close: {
            cause: projectIssue.state === "closed" && devpoolIssue.state === "open" && !!projectIssue.assignee?.login,
            effect: "closed",
            comment: "Closed (assigned-closed)",
        },
        // it's closed, not merged and still open in the devpool
        issueClosed_Close: {
            cause: projectIssue.state === "closed" && devpoolIssue.state === "open",
            effect: "closed",
            comment: "Closed (not merged)",
        },
        // it's open, assigned and still open in the devpool
        issueAssignedOpen_Close: {
            cause: projectIssue.state === "open" && devpoolIssue.state === "open" && !!projectIssue.assignee?.login,
            effect: "closed",
            comment: "Closed (assigned-open)",
        },
        // it's open, merged, unassigned, has price labels and is closed in the devpool
        issueReopenedMerged_Open: {
            cause:
                projectIssue.state === "open" &&
                devpoolIssue.state === "closed" &&
                !!projectIssue.pull_request?.merged_at &&
                !hasNoPriceLabels &&
                !projectIssue.assignee?.login,
            effect: "open",
            comment: "Reopened (merged)",
        },
        // it's open, unassigned, has price labels and is closed in the devpool
        issueUnassigned_Open: {
            cause: projectIssue.state === "open" && devpoolIssue.state === "closed" && !projectIssue.assignee?.login && !hasNoPriceLabels,
            effect: "open",
            comment: "Reopened (unassigned)",
        },
    };

    let newState: "open" | "closed" | undefined = undefined;

    for (const value of Object.values(stateChanges)) {
        // if the cause is true and the effect is different from the current state
        if (value.cause && devpoolIssue.state != value.effect) {
            // if the new state is already set, then skip it
            if (newState && newState === value.effect) {
                continue;
            }

            try {
                await octokit.rest.issues.update({
                    owner: DEVPOOL_OWNER_NAME,
                    repo: DEVPOOL_REPO_NAME,
                    issue_number: devpoolIssue.number,
                    state: value.effect,
                });
                console.log(`Updated state: (${value.comment})\n${devpoolIssue.html_url} - (${projectIssue.html_url})`);
                newState = value.effect;
            } catch (err) {
                console.log(err);
            }
        }
    }

    return newState;
}