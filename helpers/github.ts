import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { Octokit } from "@octokit/rest";
import _projects from "../projects.json";
import opt from "../opt.json";
import { Statistics } from "../types/statistics";

export type GitHubIssue = RestEndpointMethodTypes["issues"]["get"]["response"]["data"];
export type GitHubLabel = RestEndpointMethodTypes["issues"]["listLabelsOnIssue"]["response"]["data"][0];

export const projects = _projects as {
  urls: string[];
  category?: Record<string, string>;
};

export const DEVPOOL_OWNER_NAME = "ubiquity";
export const DEVPOOL_REPO_NAME = "devpool-directory";
export enum LABELS {
  PRICE = "Price",
  UNAVAILABLE = "Unavailable",
}

export const octokit = new Octokit({ auth: process.env.DEVPOOL_GITHUB_API_TOKEN });

//=============
// Helpers
//=============

/**
 * Closes issues that exist in the devpool but are missing in partner projects
 *
 * Devpool and partner project issues can be
 * out of sync in the following cases:
 * - partner project issue was deleted or transferred to another repo
 * - partner project repo was deleted from https://github.com/ubiquity/devpool-directory/blob/development/projects.json
 * - partner project repo was made private
 * @param devpoolIssues all devpool issues array
 * @param projectIssues all partner project issues array
 */
export async function forceCloseMissingIssues(devpoolIssues: GitHubIssue[], projectIssues: GitHubIssue[]) {
  // for all devpool issues
  for (const devpoolIssue of devpoolIssues) {
    // if devpool issue does not exist in partners' projects then close it
    if (!projectIssues.some((projectIssue) => projectIssue.node_id === getIssueLabelValue(devpoolIssue, "id:"))) {
      if (devpoolIssue.state === "open") {
        await octokit.rest.issues.update({
          owner: DEVPOOL_OWNER_NAME,
          repo: DEVPOOL_REPO_NAME,
          issue_number: devpoolIssue.number,
          state: "closed",
        });
        console.log(`Closed (missing in partners projects): ${devpoolIssue.html_url}`);
      } else {
        console.log(`Already closed (missing in partners projects): ${devpoolIssue.html_url}`);
      }
    }
  }
}

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
  const params = orgOrRepo.split("/");
  let repos: string[] = [];
  switch (params.length) {
    case 1: // org
      try {
        const res = await octokit.paginate("GET /orgs/{org}/repos", {
          org: orgOrRepo,
        });
        repos = res.map((repo) => repo.html_url);
      } catch (e: unknown) {
        console.warn(`Getting ${orgOrRepo} org repositories failed: ${e}`);
        throw e;
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
        } else console.warn(`Getting repo ${params[0]}/${params[1]} failed: ${res.status}`);
      } catch (e: unknown) {
        console.warn(`Getting repo ${params[0]}/${params[1]} failed: ${e}`);
        throw e;
      }
      break;
    default:
      console.warn(`Neither org or nor repo GitHub provided: ${orgOrRepo}.`);
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

  // default labels
  const devpoolIssueLabels = [
    getIssuePriceLabel(issue), // price
    `Partner: ${ownerName}/${repoName}`, // partner
    `id: ${issue.node_id}`, // id
  ];

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
  const defaultPriceLabel = "Pricing: not set";
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

export async function getProjectUrls() {
  const projectUrls = new Set<string>(projects.urls);

  for (const orgOrRepo of opt.in) {
    const urls: string[] = await getRepoUrls(orgOrRepo);
    urls.forEach((url) => projectUrls.add(url));
  }
  for (const orgOrRepo of opt.out) {
    const urls: string[] = await getRepoUrls(orgOrRepo);
    urls.forEach((url) => projectUrls.delete(url));
  }

  return projectUrls;
}

// Function to calculate total rewards and tasks statistics
export async function calculateStatistics(issues: GitHubIssue[]) {
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

  await issues.forEach((issue) => {
    const labels = issue.labels as GitHubLabel[];
    const isAssigned = labels.find((label) => (label.name as string).includes(LABELS.UNAVAILABLE));
    const isCompleted = issue.state === "closed";

    // Increment tasks statistics
    tasks.total++;
    if (isAssigned) {
      tasks.assigned++;
    } else {
      tasks.notAssigned++;
    }

    if (labels.some((label) => label.name as string)) {
      const priceLabel = labels.find((label) => (label.name as string).includes("Pricing"));
      if (priceLabel) {
        // ignore pricing not set
        if (priceLabel.name === "Pricing: not set") return;

        const price = parseInt((priceLabel.name as string).split(":")[1].trim(), 10);

        if (!isNaN(price)) {
          // Increment rewards statistics, if it is assigned but not completed
          if (isAssigned && !isCompleted) {
            rewards.assigned += price;
          } else if (!isAssigned && !isCompleted) {
            rewards.notAssigned += price;
          }

          // Increment completed rewards statistics
          if (isCompleted) {
            rewards.completed += price;
          }

          rewards.total += price;
        } else {
          console.error(`Price '${priceLabel.name}' is not a valid number in issue: ${issue.number}`);
        }
      }
    }

    // Increment completed tasks statistics
    if (isCompleted) {
      tasks.completed++;
    }
  });

  return { rewards, tasks };
}

export async function writeTotalRewardsToGithub(statistics: Statistics) {
  try {
    const owner = DEVPOOL_OWNER_NAME;
    const repo = DEVPOOL_REPO_NAME;
    const filePath = "total-rewards.json";
    const content = JSON.stringify(statistics, null, 2);

    let sha: string | undefined; // Initialize sha to undefined

    // Get the SHA of the existing file, if it exists
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: filePath,
      });

      if (!Array.isArray(data)) {
        // File exists
        sha = data.sha;
      }
    } catch (error) {
      // File doesn't exist yet
      console.log(`File ${filePath} doesn't exist yet.`);
    }

    // Update or create the file
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: "Update total rewards",
      content: Buffer.from(content).toString("base64"),
      sha, // Pass the SHA if the file exists, to update it
    });

    console.log(`Total rewards written to ${filePath}`);
  } catch (error) {
    console.error(`Error writing total rewards to github file: ${error}`);
    throw error;
  }
}
