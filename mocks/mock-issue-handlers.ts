import twitter from "../helpers/twitter";
import {
  GitHubIssue,
  GitHubLabel,
  LABELS,
  octokit,
  DEVPOOL_OWNER_NAME,
  DEVPOOL_REPO_NAME,
  getDevpoolIssueLabels,
  getSocialMediaText,
  getIssueLabelValue,
  StateChanges,
  getRepoCredentials,
} from "../helpers/github";
import { writeFile } from "fs/promises";

export async function createDevPoolIssue(projectIssue: GitHubIssue, projectUrl: string, body: string, twitterMap: { [key: string]: string }) {
  // if issue is "closed" then skip it, no need to copy/paste already "closed" issues
  if (projectIssue.state == "closed") return;

  // if the project issue is assigned to someone, then skip it
  if (projectIssue.assignee?.login) return;

  // if issue doesn't have the "Price" label then skip it, no need to pollute repo with draft issues
  if (!(projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE))) return;

  // create a new issue
  const createdIssue = await octokit.rest.issues.create({
    owner: DEVPOOL_OWNER_NAME,
    repo: DEVPOOL_REPO_NAME,
    title: projectIssue.title,
    body,
    labels: getDevpoolIssueLabels(projectIssue, projectUrl),
  });
  console.log(`Created: ${createdIssue.data.html_url} (${projectIssue.html_url})`);

  // post to social media
  const socialMediaText = getSocialMediaText(createdIssue.data);
  const tweetId = await twitter.postTweet(socialMediaText);

  twitterMap[createdIssue.data.node_id] = tweetId?.id ?? "";
  await writeFile("./twitterMap.json", JSON.stringify(twitterMap));
}

export async function handleDevPoolIssue(
  projectIssues: GitHubIssue[],
  projectIssue: GitHubIssue,
  projectUrl: string,
  devpoolIssue: GitHubIssue,
  isFork: boolean
) {
  const labelRemoved = getDevpoolIssueLabels(projectIssue, projectUrl).filter((label) => label != LABELS.UNAVAILABLE);
  const [owner, repo] = getRepoCredentials(projectIssue.html_url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originals = devpoolIssue.labels.map((label) => (label as any).name);

  const hasChanges = !areEqual(originals, labelRemoved);

  console.info(originals.sort().join(",") + "======" + labelRemoved.sort().join(","));
  console.info("projectIssue", projectIssue);
  console.info("devpoolIssue", devpoolIssue);
  console.info("labelRemoved", labelRemoved);
  console.info("originals", originals);
  console.info("hasChanges", hasChanges);
  console.info("isFork", isFork);

  const metaChanges = {
    // the title of the issue has changed
    title: devpoolIssue.title != projectIssue.title,
    // the issue url has updated
    body: !isFork && devpoolIssue.body != projectIssue.html_url,
    // the price/priority labels have changed
    labels: hasChanges,
  };

  // process only the metadata changes
  // forked body will always be different because of the www
  const shouldUpdate = metaChanges.title || metaChanges.body || metaChanges.labels;

  if (shouldUpdate) {
    // update the issue

    console.info("metaChanges", metaChanges);
    console.info("CREDS:", { owner, repo, DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME });

    try {
      await octokit.rest.issues.update({
        owner: DEVPOOL_OWNER_NAME,
        repo: DEVPOOL_REPO_NAME,
        issue_number: devpoolIssue.number,
        title: metaChanges.title ? projectIssue.title : devpoolIssue.title,
        body: metaChanges.body && !isFork ? projectIssue.html_url : projectIssue.html_url.replace("https://", "https://www."),
        labels: metaChanges.labels ? labelRemoved : originals,
      });
    } catch (err) {
      console.error(err);
    }

    console.info("labels  removed", labelRemoved);
    console.info("originals", originals);

    if (metaChanges.title) console.info(`Title: ${devpoolIssue.title} -> ${projectIssue.title}`);
    if (!isFork && metaChanges.body) console.info(`Body: ${!isFork && metaChanges.body ? projectIssue.html_url : devpoolIssue.body}`);
    if (hasChanges) console.info(`Labels: ${originals} -> ${labelRemoved}`);

    if (metaChanges.title || metaChanges.body || hasChanges) console.log(`Updated metadata: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
    if (metaChanges.title) console.log(`Title: ${devpoolIssue.title} -> ${projectIssue.title}`);
    if (metaChanges.body) console.log(`Body: ${devpoolIssue.body} -> ${projectIssue.html_url}`);
    if (hasChanges) console.log(`Labels: ${originals} -> ${labelRemoved}`);
  }

  const hasNoPriceLabels = !(projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE));

  // these changes will open/close issues
  const stateChanges: StateChanges = {
    // missing in the partners
    forceMissing_Close: {
      cause: !projectIssues.some((projectIssue) => projectIssue.node_id == getIssueLabelValue(devpoolIssue, "id:")),
      effect: "closed",
      comment: "Closed (missing in partners):",
    },
    // no price labels set and open in the devpool
    noPriceLabels_Close: {
      cause: hasNoPriceLabels && devpoolIssue.state == "open",
      effect: "closed",
      comment: "Closed (no price labels):",
    },
    // it's closed, been merged and still open in the devpool
    issueComplete_Close: {
      cause: projectIssue.state == "closed" && devpoolIssue.state == "open" && !!projectIssue.pull_request?.merged_at,
      effect: "closed",
      comment: "Closed (merged):",
    },
    // it's closed, assigned and still open in the devpool
    issueAssignedClosed_Close: {
      cause: projectIssue.state == "closed" && devpoolIssue.state == "open" && !!projectIssue.assignee?.login,
      effect: "closed",
      comment: "Closed (assigned-closed):",
    },
    // it's closed, not merged and still open in the devpool
    issueClosed_Close: {
      cause: projectIssue.state == "closed" && devpoolIssue.state == "open",
      effect: "closed",
      comment: "Closed (not merged):",
    },

    // it's open, assigned and still open in the devpool
    issueAssignedOpen_Close: {
      cause: projectIssue.state == "open" && devpoolIssue.state == "open" && !!projectIssue.assignee?.login,
      effect: "closed",
      comment: "Closed (assigned-open):",
    },
    // it's open, merged, unassigned and closed in the devpool
    issueReopenedMerged_Open: {
      cause:
        projectIssue.state == "open" &&
        devpoolIssue.state == "closed" &&
        !!projectIssue.pull_request?.merged_at &&
        !hasNoPriceLabels &&
        !projectIssue.assignee?.login,
      effect: "open",
      comment: "Reopened (merged):",
    },
    // it's open, unassigned and closed in the devpool
    issueUnassigned_Open: {
      cause: projectIssue.state == "open" && devpoolIssue.state == "closed" && !projectIssue.assignee?.login && !hasNoPriceLabels,
      effect: "open",
      comment: "Reopened (unassigned):",
    },
  };
  // project issue state is open, assigned, merged and devpool issue state is closed

  let newState: "open" | "closed" | undefined = undefined;

  // then process the state changes
  for (const [, value] of Object.entries(stateChanges)) {
    // if the cause is true and the effect is different from the current state
    if (value.cause && devpoolIssue.state != value.effect) {
      // if the new state is already set, then skip it
      if (newState && newState == value.effect) {
        console.log(`Already set to ${value.effect}`);
        continue;
      }

      try {
        await octokit.rest.issues.update({
          owner: DEVPOOL_OWNER_NAME,
          repo: DEVPOOL_REPO_NAME,
          issue_number: devpoolIssue.number,
          state: value.effect,
        });

        console.info(`Updated state: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
        console.info(`${value.comment}: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
        console.info(`${value.comment}: ${projectIssue.node_id}-${projectIssue.number}`);

        console.log(`Updated state: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
        console.log(`${value.comment}: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
        console.log(`${value.comment}: ${projectIssue.node_id}-${projectIssue.number}`);

        newState = value.effect;
      } catch (err) {
        console.log(err);
      }
    }
  }
}

function areEqual(a: string[], b: string[]) {
  return a.sort().join(",") === b.sort().join(",");
}
