import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { Octokit } from "@octokit/rest";
import optInOptOut from "../opt.json";
import _projects from "../projects.json";
import { commitTwitterMap } from "./git";
import twitter from "./twitter";
import { TwitterMap } from "..";

const PRICING_NOT_SET = "Pricing: not set";

export const DEVPOOL_OWNER_NAME = process.env.DEVPOOL_OWNER_NAME as string;
export const DEVPOOL_REPO_NAME = process.env.DEVPOOL_REPO_NAME as string;

if (!DEVPOOL_OWNER_NAME || !DEVPOOL_REPO_NAME) {
  throw new Error("DEVPOOL_OWNER_NAME or DEVPOOL_REPO_NAME not set");
}
if (typeof DEVPOOL_OWNER_NAME !== "string" || typeof DEVPOOL_REPO_NAME !== "string") {
  throw new Error("DEVPOOL_OWNER_NAME or DEVPOOL_REPO_NAME is not a string");
}

export type GitHubIssue = RestEndpointMethodTypes["issues"]["get"]["response"]["data"];
export type GitHubLabel = RestEndpointMethodTypes["issues"]["listLabelsOnIssue"]["response"]["data"][0];

export type StateChanges<T extends string = "open" | "closed"> = {
  [key: string]: {
    cause: boolean;
    effect: T;
    comment: string;
  };
};

export const projects = _projects as {
  urls: string[];
  category?: Record<string, string>;
};

export enum LABELS {
  PRICE = "Price",
  UNAVAILABLE = "Unavailable",
}

export const octokit = new Octokit({ auth: process.env.DEVPOOL_GITHUB_API_TOKEN });

//=============
// Helpers
//=============

/**
 * Stops forks from spamming real Ubiquity issues with links to their forks
 * @returns true if the authenticated user is Ubiquity
 */
export async function checkIfForked(user: string) {
  return user !== "ubiquity";
}

/**
 * Returns all issues in a repo
 * @param ownerName owner name
 * @param repoName repo name
 * @returns array of issues
 */
export async function getAllIssues(ownerName: string, repoName: string) {
  // get all project issues (opened and closed)
  let issues: GitHubIssue[] = await octokit.paginate({
    method: "GET",
    url: `/repos/${ownerName}/${repoName}/issues?state=all`,
  });
  // remove PRs from the project issues
  issues = issues.filter((issue) => !issue.pull_request);

  return issues;
}

/**
 * Returns all org repositories urls or owner/repo url
 * @param orgOrRepo org or repository name
 * @returns array of repository urls
 */
export async function getRepoUrls(orgOrRepo: string) {
  if (!orgOrRepo) {
    console.warn("No org or repo provided: ", orgOrRepo);
    return [];
  }

  if (orgOrRepo.startsWith("/") || orgOrRepo.endsWith("/")) {
    console.warn("Invalid org or repo provided: ", orgOrRepo);
    return [];
  }

  const params = orgOrRepo.split("/");
  let repos: string[] = [];
  try {
    switch (params.length) {
      case 1: // org
        try {
          const res = await octokit.paginate("GET /orgs/{org}/repos", {
            org: orgOrRepo,
          });
          repos = res.map((repo) => repo.html_url);
          console.info(`Getting ${orgOrRepo} org repositories: ${repos.length}`);
        } catch (error: unknown) {
          console.warn(`Getting ${orgOrRepo} org repositories failed: ${error}`);
          throw error;
        }
        break;
      case 2: // owner/repo
        try {
          const res = await octokit.rest.repos.get({
            owner: params[0],
            repo: params[1],
          });

          if (res.status === 200) {
            repos.push(res.data.html_url);
            console.info(`Getting repo ${params[0]}/${params[1]}: ${res.data.html_url}`);
          } else console.warn(`Getting repo ${params[0]}/${params[1]} failed: ${res.status}`);
        } catch (error: unknown) {
          console.warn(`Getting repo ${params[0]}/${params[1]} failed: ${error}`);
          throw error;
        }
        break;
      default:
        console.warn(`Neither org or nor repo GitHub provided: ${orgOrRepo}.`);
    }
  } catch (err) {
    console.error(err);
  }

  return repos;
}

/**
 * Returns array of labels for a devpool issue
 * @param issue issue object
 * @param projectUrl url of the project
 */
export function getDevpoolIssueLabels(issue: GitHubIssue, projectUrl: string) {
  // get owner and repo name from issue's URL because the repo name could be updated
  const [ownerName, repoName] = getRepoCredentials(issue.html_url);

  const pricing = getIssuePriceLabel(issue);

  let devpoolIssueLabels: string[];

  // default labels
  if (pricing != PRICING_NOT_SET) {
    devpoolIssueLabels = [
      pricing,
      `Partner: ${ownerName}/${repoName}`, // partner
      `id: ${issue.node_id}`, // id
    ];
  } else {
    devpoolIssueLabels = [
      `Partner: ${ownerName}/${repoName}`, // partner
      `id: ${issue.node_id}`, // id
    ];
  }

  // if project is already assigned then add the "Unavailable" label
  if (issue.assignee?.login) devpoolIssueLabels.push(LABELS.UNAVAILABLE);

  const labels = issue.labels as GitHubLabel[];

  // add all missing labels that exist in a project's issue and don't exist in devpool issue
  for (const projectIssueLabel of labels) {
    // skip the "Price" label in order to not accidentally generate a permit
    if (projectIssueLabel.name.includes("Price")) continue;
    // if project issue label does not exist in devpool issue then add it
    if (!devpoolIssueLabels.includes(projectIssueLabel.name)) devpoolIssueLabels.push(projectIssueLabel.name);
  }

  // if project category for the project is defined, add its category label
  if (projects.category && projectUrl in projects.category) devpoolIssueLabels.push(projects.category[projectUrl]);

  return devpoolIssueLabels;
}

/**
 * Returns issue by label
 * @param issues issues array
 * @param label label string
 */
export function getIssueByLabel(issues: GitHubIssue[], label: string) {
  issues = issues.filter((issue) => {
    const labels = (issue.labels as GitHubLabel[]).filter((obj) => obj.name === label);
    return labels.length > 0;
  });
  return issues.length > 0 ? issues[0] : null;
}

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

/**
 * Returns owner and repository names from a project URL
 * @param projectUrl project URL
 * @returns array of owner and repository names
 */
export function getRepoCredentials(projectUrl: string) {
  const urlObject = new URL(projectUrl);
  const urlPath = urlObject.pathname.split("/");
  const ownerName = urlPath[1];
  const repoName = urlPath[2];
  if (!ownerName || !repoName) {
    throw new Error(`Missing owner name or repo name in [${projectUrl}]`);
  }
  return [ownerName, repoName];
}

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

export async function getProjectUrls(opt: typeof optInOptOut = optInOptOut) {
  const projectUrls = new Set<string>(projects.urls);

  for (const orgOrRepo of opt.in) {
    const urls: string[] = await getRepoUrls(orgOrRepo);
    urls.forEach((url) => projectUrls.add(url));
  }

  for (const orgOrRepo of opt.out) {
    const len = orgOrRepo.split("/").length;

    if (len === 1) {
      // it's an org, delete all org repos in the list
      projectUrls.forEach((url) => {
        if (url.includes(orgOrRepo)) {
          const [owner, repo] = getRepoCredentials(url);
          if (opt.in.includes(`${owner}/${repo}`)) {
            return;
          }
          projectUrls.delete(url);
        }
      });
    } else {
      // it's a repo, delete the repo from the list
      projectUrls.forEach((url) => url === `https://github.com/${orgOrRepo}` && projectUrls.delete(url));
    }
  }

  return projectUrls;
}

// Function to calculate total rewards and tasks statistics
export async function calculateStatistics(devpoolIssues: GitHubIssue[]) {
  const rewards = {
    notAssigned: 0,
    assigned: 0,
    completed: 0,
    total: 0,
  };

  const tasks = {
    notAssigned: 0,
    assigned: 0,
    completed: 0,
    total: 0,
  };

  devpoolIssues.forEach((issue) => {
    if (!issue.repository_url || !issue.html_url) return;
    if (!issue.repository_url.includes(DEVPOOL_REPO_NAME) || !issue.html_url.includes(DEVPOOL_REPO_NAME)) return;
    if ("repo" in issue && issue.repo != DEVPOOL_REPO_NAME) return;

    const linkedRepoFromBody = issue.body?.match(/https:\/\/github.com\/[^/]+\/[^/]+/);
    const linkedRepoFromBodyAlt = issue.body?.match(/https:\/\/www.github.com\/[^/]+\/[^/]+/);

    let shouldExclude = optInOptOut.out.some((orgOrRepo) => linkedRepoFromBody?.[0].includes(orgOrRepo));
    shouldExclude = shouldExclude || optInOptOut.out.some((orgOrRepo) => linkedRepoFromBodyAlt?.[0].includes(orgOrRepo));

    const labels = issue.labels as GitHubLabel[];
    // devpool issue has unavailable label because it's assigned and so it's closed
    const isAssigned = labels.find((label) => (label.name as string).includes(LABELS.UNAVAILABLE)) && issue.state === "closed";
    // devpool issue doesn't have unavailable label because it's unassigned and closed so it's merged therefore completed
    const isCompleted = !labels.some((label) => (label.name as string).includes(LABELS.UNAVAILABLE)) && issue.state === "closed";
    const isOpen = issue.state === "open";
    const priceLabel = labels.find((label) => (label.name as string).includes("Pricing"));
    const price = priceLabel ? parseInt((priceLabel.name as string).split(":")[1].trim(), 10) : 0;

    if (isOpen && !shouldExclude) {
      rewards.notAssigned += !isNaN(price) ? price : 0;
      tasks.notAssigned++;
      tasks.total++;
      rewards.total += !isNaN(price) ? price : 0;
    } else if (isAssigned && !shouldExclude) {
      rewards.assigned += !isNaN(price) ? price : 0;
      tasks.assigned++;
      tasks.total++;
      rewards.total += !isNaN(price) ? price : 0;
    } else if (isCompleted) {
      rewards.completed += !isNaN(price) ? price : 0;
      tasks.completed++;
      tasks.total++;
      rewards.total += !isNaN(price) ? price : 0;
    } else {
      console.error(`Issue ${issue.number} is not assigned, not completed and not open`);
    }
  });

  return { rewards, tasks };
}

export async function createDevPoolIssue(projectIssue: GitHubIssue, projectUrl: string, body: string, twitterMap: TwitterMap) {
  // if issue is "closed" then skip it, no need to copy/paste already "closed" issues
  if (projectIssue.state === "closed") return;

  // if the project issue is assigned to someone, then skip it
  if (projectIssue.assignee) return;

  // check if the issue is the same type as it should be
  const hasPriceLabel = (projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE));

  // create a new issue
  try {
    const createdIssue = await octokit.rest.issues.create({
      owner: DEVPOOL_OWNER_NAME,
      repo: DEVPOOL_REPO_NAME,
      title: projectIssue.title,
      body,
      labels: getDevpoolIssueLabels(projectIssue, projectUrl),
    });
    console.log(`Created: ${createdIssue.data.html_url} (${projectIssue.html_url})`);

    if (!createdIssue) {
      console.log("No new issue to tweet about");
      return;
    }

    // post to social media (only if it's not an RFC)
    if (hasPriceLabel) {
      try {
        const socialMediaText = getSocialMediaText(createdIssue.data);
        const tweetId = await twitter.postTweet(socialMediaText);

        if (tweetId) {
          twitterMap[createdIssue.data.node_id] = tweetId?.id ?? "";
          // await writeFile("./twitter-map.json", JSON.stringify(twitterMap));
          await commitTwitterMap(twitterMap);
        }
      } catch (err) {
        console.error("Failed to post tweet: ", err);
      }
    }
  } catch (err) {
    console.error("Failed to create new issue: ", err);
    return;
  }
}

export async function handleDevPoolIssue(
  projectIssues: GitHubIssue[],
  projectIssue: GitHubIssue,
  projectUrl: string,
  devpoolIssue: GitHubIssue,
  isFork: boolean
) {
  // remove the unavailable label as getDevpoolIssueLabels() adds it and statistics rely on it
  const labelRemoved = getDevpoolIssueLabels(projectIssue, projectUrl).filter((label) => label != LABELS.UNAVAILABLE);
  const originals = devpoolIssue.labels.map((label) => (label as GitHubLabel).name);
  const hasChanges = !areEqual(originals, labelRemoved);

  let shouldUpdateBody = false;

  if (!isFork && devpoolIssue.body != projectIssue.html_url) {
    // not a fork, so body uses https://github.com
    shouldUpdateBody = true;
  } else if (isFork && devpoolIssue.body != projectIssue.html_url.replace("https://", "https://www.")) {
    // it's a fork, so body uses https://www.github.com
    shouldUpdateBody = true;
  }

  const metaChanges = {
    // the title of the issue has changed
    title: devpoolIssue.title != projectIssue.title,
    // the issue url has updated
    body: shouldUpdateBody,
    // the price/priority labels have changed
    labels: hasChanges,
  };

  await applyMetaChanges(metaChanges, devpoolIssue, projectIssue, isFork, labelRemoved, originals);

  const newState = await applyStateChanges(projectIssues, projectIssue, devpoolIssue);

  await applyUnavailableLabelToDevpoolIssue(
    projectIssue,
    devpoolIssue,
    metaChanges,
    labelRemoved,
    originals,
    newState ?? (devpoolIssue.state as "open" | "closed")
  );
}

async function applyMetaChanges(
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

async function applyStateChanges(projectIssues: GitHubIssue[], projectIssue: GitHubIssue, devpoolIssue: GitHubIssue) {
  const stateChanges: StateChanges = {
    // missing in the partners
    forceMissing_Close: {
      cause: !projectIssues.some((projectIssue) => projectIssue.node_id === getIssueLabelValue(devpoolIssue, "id:")),
      effect: "closed",
      comment: "Closed (missing in partners)",
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
    // it's open, merged, unassigned and is closed in the devpool
    issueReopenedMerged_Open: {
      cause: projectIssue.state === "open" && devpoolIssue.state === "closed" && !!projectIssue.pull_request?.merged_at && !projectIssue.assignee?.login,
      effect: "open",
      comment: "Reopened (merged)",
    },
    // it's open, unassigned and is closed in the devpool
    issueUnassigned_Open: {
      cause: projectIssue.state === "open" && devpoolIssue.state === "closed" && !projectIssue.assignee?.login,
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

async function applyUnavailableLabelToDevpoolIssue(
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

function areEqual(a: string[], b: string[]) {
  return a.sort().join(",") === b.sort().join(",");
}
