import dotenv from "dotenv";
dotenv.config();
import opt from "./opt.json";
import _projects from "./projects.json";
import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { Octokit } from "@octokit/rest";
type GitHubIssue = RestEndpointMethodTypes["issues"]["get"]["response"]["data"];
type GitHubLabel = {
  id: number;
  node_id: string;
  url: string;
  name: string;
  description: string | null;
  color: string | null;
  default: boolean;
};
const projects = _projects as {
  urls: string[];
  category?: Record<string, string>;
};

const DEVPOOL_OWNER_NAME = "ubiquity";
const DEVPOOL_REPO_NAME = "devpool-directory";
enum LABELS {
  PRICE = "Price",
  UNAVAILABLE = "Unavailable",
}

// init octokit
const octokit = new Octokit({ auth: process.env.DEVPOOL_GITHUB_API_TOKEN });

/**
 * Main function
 * TODO: retry on rate limit error
 * TODO: handle project deletion
 */
async function main() {
  try {
    // get devpool issues
    const devpoolIssues: GitHubIssue[] = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);

    // aggregate projects.urls and opt settings
    const projectUrls = new Set<string>(projects.urls);

    for (const orgOrRepo of opt.in) {
      const urls: string[] = await getRepoUrls(orgOrRepo);
      urls.forEach((url) => projectUrls.add(url));
    }
    for (const orgOrRepo of opt.out) {
      const urls: string[] = await getRepoUrls(orgOrRepo);
      urls.forEach((url) => projectUrls.delete(url));
    }

    // aggregate all project issues
    const allProjectIssues: GitHubIssue[] = [];

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
        if (devpoolIssue) {
          // If project issue doesn't have the "Price" label (i.e. it has been removed) then close
          // the devpool issue if it is not already closed, no need to pollute devpool repo with draft issues
          if (!(projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE))) {
            if (devpoolIssue.state === "open") {
              await octokit.rest.issues.update({
                owner: DEVPOOL_OWNER_NAME,
                repo: DEVPOOL_REPO_NAME,
                issue_number: devpoolIssue.number,
                state: "closed",
              });
              console.log(`Closed (price label not set): ${devpoolIssue.html_url} (${projectIssue.html_url})`);
            } else {
              console.log(`Already closed (price label not set): ${devpoolIssue.html_url} (${projectIssue.html_url})`);
            }
            continue;
          }
          // prepare for issue updating
          const isDevpoolUnavailableLabel = (devpoolIssue.labels as GitHubLabel[])?.some((label) => label.name === LABELS.UNAVAILABLE);
          const devpoolIssueLabelsStringified = (devpoolIssue.labels as GitHubLabel[])
            .map((label) => label.name)
            .sort()
            .toString();
          const projectIssueLabelsStringified = getDevpoolIssueLabels(projectIssue, projectUrl).sort().toString();
          // Update devpool issue if any of the following has been updated:
          // - issue title
          // - issue state (open/closed)
          // - assignee (exists or not)
          // - repository name (devpool issue body contains a partner project issue URL)
          // - any label
          if (
            devpoolIssue.title !== projectIssue.title ||
            devpoolIssue.state !== projectIssue.state ||
            (!isDevpoolUnavailableLabel && projectIssue.assignee?.login) ||
            (isDevpoolUnavailableLabel && !projectIssue.assignee?.login) ||
            devpoolIssue.body !== projectIssue.html_url ||
            devpoolIssueLabelsStringified !== projectIssueLabelsStringified
          ) {
            await octokit.rest.issues.update({
              owner: DEVPOOL_OWNER_NAME,
              repo: DEVPOOL_REPO_NAME,
              issue_number: devpoolIssue.number,
              title: projectIssue.title,
              body: projectIssue.html_url,
              state: projectIssue.state as "open" | "closed",
              labels: getDevpoolIssueLabels(projectIssue, projectUrl),
            });
            console.log(`Updated: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
          } else {
            console.log(`No updates: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
          }
        } else {
          // issue does not exist in devpool
          // if issue is "closed" then skip it, no need to copy/paste already "closed" issues
          if (projectIssue.state === "closed") continue;
          // if issue doesn't have the "Price" label then skip it, no need to pollute repo with draft issues
          if (!(projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE))) continue;
          // create a new issue
          const createdIssue = await octokit.rest.issues.create({
            owner: DEVPOOL_OWNER_NAME,
            repo: DEVPOOL_REPO_NAME,
            title: projectIssue.title,
            body: projectIssue.html_url,
            labels: getDevpoolIssueLabels(projectIssue, projectUrl),
          });
          console.log(`Created: ${createdIssue.data.html_url} (${projectIssue.html_url})`);
        }
      }
    }

    // close missing issues
    await forceCloseMissingIssues(devpoolIssues, allProjectIssues);
  } catch (err) {
    console.log(err);
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error(error);
  }
})();

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
async function forceCloseMissingIssues(devpoolIssues: GitHubIssue[], projectIssues: GitHubIssue[]) {
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
 * Returns all issues in a repo
 * @param ownerName owner name
 * @param repoName repo name
 * @returns array of issues
 */
async function getAllIssues(ownerName: string, repoName: string) {
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
async function getRepoUrls(orgOrRepo: string) {
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
        } else console.warn(`Getting owner/repo failed: ${res.status}`);
      } catch (e: unknown) {
        console.warn(`Getting owner/repo failed: ${e}`);
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
 */
function getDevpoolIssueLabels(issue: GitHubIssue, projectUrl: string) {
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
function getIssueByLabel(issues: GitHubIssue[], label: string) {
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
function getIssueLabelValue(issue: GitHubIssue, labelPrefix: string) {
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
function getIssuePriceLabel(issue: GitHubIssue) {
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
function getRepoCredentials(projectUrl: string) {
  const urlObject = new URL(projectUrl);
  const urlPath = urlObject.pathname.split("/");
  const ownerName = urlPath[1];
  const repoName = urlPath[2];
  return [ownerName, repoName];
}
