import dotenv from "dotenv";
import twitter from "./helpers/twitter";
import {
  DEVPOOL_OWNER_NAME,
  DEVPOOL_REPO_NAME,
  getAllIssues,
  getDevpoolIssueLabels,
  getIssueByLabel,
  getProjectUrls,
  getRepoCredentials,
  getSocialMediaText,
  GitHubIssue,
  GitHubLabel,
  checkIfForked,
  LABELS,
  octokit,
  calculateStatistics,
  writeTotalRewardsToGithub,
  getIssueLabelValue,
} from "./helpers/github";
import { readFile, writeFile } from "fs/promises";
import { Statistics } from "./types/statistics";
// init octokit
dotenv.config();

type StateChanges<T extends string = "open" | "closed"> = {
  [key: string]: {
    cause: boolean;
    effect: T;
    comment: string;
  };
};

/**
 * Main function
 * TODO: retry on rate limit error
 * TODO: handle project deletion
 */
async function main() {
  let twitterMap: { [key: string]: string } = {};
  try {
    twitterMap = JSON.parse(await readFile("./twitterMap.json", "utf8"));
  } catch (error) {
    console.log("Couldnt find twitter map artifact, creating a new one");
    await writeFile("./twitterMap.json", JSON.stringify({}));
  }

  // get devpool issues
  const devpoolIssues: GitHubIssue[] = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);

  // Calculate total rewards from open issues
  const { rewards, tasks } = await calculateStatistics(devpoolIssues);
  const statistics: Statistics = { rewards, tasks };

  await writeTotalRewardsToGithub(statistics);

  // aggregate projects.urls and opt settings
  const projectUrls = await getProjectUrls();

  // aggregate all project issues
  const allProjectIssues: GitHubIssue[] = [];

  const isFork = await checkIfForked(DEVPOOL_OWNER_NAME);

  // for each project URL
  for (const projectUrl of projectUrls) {
    // get owner and repository names from project URL
    const [ownerName, repoName] = getRepoCredentials(projectUrl);
    // get all project issues (opened and closed)
    const projectIssues: GitHubIssue[] = await getAllIssues(ownerName, repoName);
    // aggregate all project issues
    allProjectIssues.push(...projectIssues);
    // for all issues
    for (const projectIssue of projectIssues) {
      // if issue exists in devpool
      const devpoolIssue = getIssueByLabel(devpoolIssues, `id: ${projectIssue.node_id}`);

      // adding www creates a link to an issue that does not count as a mention
      // helps with preventing a mention in partner's repo especially during testing
      const body = isFork ? projectIssue.html_url.replace("https://github.com", "https://www.github.com") : projectIssue.html_url;

      // for all issues
      if (devpoolIssue) {
        // if it exists in the devpool, then update it
        await handleDevPoolIssue(projectIssues, projectIssue, projectUrl, devpoolIssue, body, twitterMap, isFork);
      } else {
        // if it doesn't exist in the devpool, then create it
        await createDevPoolIssue(projectIssue, projectUrl, body, twitterMap);
      }
    }
  }
}

void (async () => {
  await main();
})();

// Expose the main only for testing purposes
if (process.env.NODE_ENV === "test") {
  exports.main = main;
}

async function createDevPoolIssue(projectIssue: GitHubIssue, projectUrl: string, body: string, twitterMap: { [key: string]: string }) {
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

async function handleDevPoolIssue(
  projectIssues: GitHubIssue[],
  projectIssue: GitHubIssue,
  projectUrl: string,
  devpoolIssue: GitHubIssue,
  body: string,
  twitterMap: { [key: string]: string },
  isFork: boolean
) {
  if (projectIssue.state == "closed" && twitterMap[devpoolIssue.node_id]) {
    await twitter.deleteTweet(twitterMap[devpoolIssue.node_id]);
    delete twitterMap[devpoolIssue.node_id];
    await writeFile("./twitterMap.json", JSON.stringify(twitterMap));
  }

  const metaChanges = {
    // the title of the issue has changed
    title: devpoolIssue.title != projectIssue.title,
    // the issue url has updated
    body: devpoolIssue.body != projectIssue.html_url,
    // the price/priority labels have changed
    labels:
      (devpoolIssue.labels as GitHubLabel[])
        .map((label) => label.name)
        .sort()
        .toString() != getDevpoolIssueLabels(projectIssue, projectUrl).sort().toString(),
  };

  // process only the metadata changes
  // forked body will always be different because of the www
  if (metaChanges.title || (!isFork && metaChanges.body) || metaChanges.labels) {
    await octokit.rest.issues.update({
      owner: DEVPOOL_OWNER_NAME,
      repo: DEVPOOL_REPO_NAME,
      issue_number: devpoolIssue.number,
      title: projectIssue.title,
      body,
      labels: getDevpoolIssueLabels(projectIssue, projectUrl),
    });

    console.log(`Updated issue metadata:\nDevpool Issue: ${devpoolIssue.html_url}\nProject Issue: ${projectIssue.html_url}`);
  }

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
      cause: !(projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE)) && devpoolIssue.state == "open",
      effect: "closed",
      comment: "Closed (no price labels):",
    },
    // it's closed, been merged and still open in the devpool
    issueComplete_Close: {
      cause: projectIssue.state == "closed" && devpoolIssue.state == "open" && !!projectIssue.pull_request?.merged_at,
      effect: "closed",
      comment: "Closed (merged):",
    },
    // it's closed, not merged and still open in the devpool
    issueClosed_Close: {
      cause: projectIssue.state == "closed" && devpoolIssue.state == "open",
      effect: "closed",
      comment: "Closed (not merged): ",
    },
    // it's closed, assigned and still open in the devpool
    issueAssignedClosed_Close: {
      cause: projectIssue.state == "closed" && devpoolIssue.state == "open" && !!projectIssue.assignee?.login,
      effect: "closed",
      comment: "Closed (assigned-closed):",
    },
    // it's open, assigned and still open in the devpool
    issueAssignedOpen_Close: {
      cause: projectIssue.state == "open" && devpoolIssue.state == "open" && !!projectIssue.assignee?.login,
      effect: "closed",
      comment: "Closed (assigned-open):",
    },
    // it's open, unassigned and closed in the devpool
    issueUnassigned_Open: {
      cause: projectIssue.state == "open" && devpoolIssue.state == "closed" && !projectIssue.assignee?.login,
      effect: "open",
      comment: "Reopened (unassigned):",
    },
    // it's open, merged and closed in the devpool
    issueReopenedMerged_Open: {
      cause: projectIssue.state == "open" && devpoolIssue.state == "closed" && !!projectIssue.pull_request?.merged_at,
      effect: "open",
      comment: "Reopened (merged):",
    },
  };

  let newState: "open" | "closed" | undefined = undefined;

  // then process the state changes
  for (const [, value] of Object.entries(stateChanges)) {
    // if the cause is true and the effect is different from the current state
    if (value.cause && devpoolIssue.state != value.effect) {
      // if the new state is already set, then skip it
      if (newState && newState == value.effect) continue;

      try {
        await octokit.rest.issues.update({
          owner: DEVPOOL_OWNER_NAME,
          repo: DEVPOOL_REPO_NAME,
          issue_number: devpoolIssue.number,
          state: value.effect,
        });

        newState = value.effect;
      } catch (err) {
        console.log(err);
      }

      console.log(`${value.comment}:\nDevpool Issue: ${devpoolIssue.html_url}\nProject Issue: ${projectIssue.html_url}`);
    }
  }
}
