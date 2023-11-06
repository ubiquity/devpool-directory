/**
 * Syncs issues with partner projects
 */

import dotenv from 'dotenv';
import { Octokit } from 'octokit';
import _projects from './projects.json';

interface Projects{
  urls: string[];
  category?: Record<string, string>
}

const projects = _projects as Projects;

// init env variables
dotenv.config();

const DEVPOOL_OWNER_NAME = "ubiquity";
const DEVPOOL_REPO_NAME = "devpool-directory";

type Issue = {
  html_url: string,
  labels: {
    name: string,
  }[],
  node_id: string,
  number: number,
  pull_request: null | {},
  state: 'open' | 'closed',
  title: string,
  body?: string;
  assignee: {
    login: string;
  };
}

enum LABELS {
  PRICE = 'Price',
  UNAVAILABLE = 'Unavailable',
};

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
    const devpoolIssues: Issue[] = await getAllIssues(
      DEVPOOL_OWNER_NAME,
      DEVPOOL_REPO_NAME
    );

    // aggregate all project issues
    const allProjectIssues: Issue[] = [];

    // for each project URL
    for (let projectUrl of projects.urls) {
      // get owner and repository names from project URL
      const [ownerName, repoName] = getRepoCredentials(projectUrl);
      // get all project issues (opened and closed)
      const projectIssues: Issue[] = await getAllIssues(ownerName, repoName);
      // aggregate all project issues
      allProjectIssues.push(...projectIssues);
      // for all issues
      for (let projectIssue of projectIssues) {
        // if issue exists in devpool
        const devpoolIssue = getIssueByLabel(devpoolIssues, `id: ${projectIssue.node_id}`);
        if (devpoolIssue) {
          // If project issue doesn't have the "Price" label (i.e. it has been removed) then close 
          // the devpool issue if it is not already closed, no need to pollute devpool repo with draft issues
          if (!projectIssue.labels.some(label => label.name.includes(LABELS.PRICE))) {
            if (devpoolIssue.state === 'open') {
              await octokit.rest.issues.update({
                owner: DEVPOOL_OWNER_NAME,
                repo: DEVPOOL_REPO_NAME,
                issue_number: devpoolIssue.number,
                state: 'closed',
              });
              console.log(`Closed (price label not set): ${devpoolIssue.html_url} (${projectIssue.html_url})`);
            } else {
              console.log(`Already closed (price label not set): ${devpoolIssue.html_url} (${projectIssue.html_url})`);
            }
            continue;
          }
          // prepare for issue updating
          const isDevpoolUnavailableLabel = devpoolIssue.labels?.some((label) => label.name === LABELS.UNAVAILABLE);
          const devpoolIssueLabelsStringified = devpoolIssue.labels.map(label => label.name).sort().toString();
          const projectIssueLabelsStringified = getDevpoolIssueLabels(projectIssue, projectUrl).sort().toString();
          // Update devpool issue if any of the following has been updated:
          // - issue title
          // - issue state (open/closed)
          // - assignee (exists or not)
          // - repository name (devpool issue body contains a partner project issue URL)
          // - any label
          if (devpoolIssue.title !== projectIssue.title ||
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
              state: projectIssue.state,
              labels: getDevpoolIssueLabels(projectIssue, projectUrl),
            });
            console.log(`Updated: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
          } else {
            console.log(`No updates: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
          }
        } else {
          // issue does not exist in devpool
          // if issue is "closed" then skip it, no need to copy/paste already "closed" issues
          if (projectIssue.state === 'closed') continue;
          // if issue doesn't have the "Price" label then skip it, no need to pollute repo with draft issues
          if (!projectIssue.labels.some(label => label.name.includes(LABELS.PRICE))) continue;
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

main();

//=============
// Helpers
//=============

/**
 * Deletes github issue
 * @param nodeId issue node id
 */
async function deleteIssue(nodeId: string) {
  await octokit.graphql(
    `
      mutation($input:DeleteIssueInput!) {
        deleteIssue(input:$input) {
          clientMutationId
        }
      }
    `,
    {
      input: {
        issueId: nodeId,
        clientMutationId: 'devpool',
      }
    }
  );
}

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
async function forceCloseMissingIssues(
  devpoolIssues: Issue[],
  projectIssues: Issue[],
) {
  // for all devpool issues
  for (let devpoolIssue of devpoolIssues) {
    // if devpool issue does not exist in partners' projects then close it
    if (!projectIssues.some(projectIssue => projectIssue.node_id === getIssueLabelValue(devpoolIssue, 'id:'))) {
      if (devpoolIssue.state === 'open') {
        await octokit.rest.issues.update({
          owner: DEVPOOL_OWNER_NAME,
          repo: DEVPOOL_REPO_NAME,
          issue_number: devpoolIssue.number,
          state: 'closed',
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
  let issues: Issue[] = await octokit.paginate({
    method: "GET",
    url: `/repos/${ownerName}/${repoName}/issues?state=all`,
  });
  // remove PRs from the project issues
  issues = issues.filter((issue) => !issue.pull_request);

  return issues;
}

/**
 * Returns array of labels for a devpool issue
 * @param issue issue object
 */
function getDevpoolIssueLabels(
  issue: Issue,
  projectUrl: string
) {
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

  // add all missing labels that exist in a project's issue and don't exist in devpool issue
  for (let projectIssueLabel of issue.labels) {
    // skip the "Price" label in order to not accidentally generate a permit
    if (projectIssueLabel.name.includes('Price')) continue;
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
function getIssueByLabel(issues: Issue[], label: string) {
  issues = issues.filter((issue) => {
    const labels = issue.labels.filter((obj) => obj.name === label);
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
function getIssueLabelValue(issue: Issue, labelPrefix: string) {
  let labelValue = null;
  for (let labelObj of issue.labels) {
    if (labelObj.name.includes(labelPrefix)) {
      labelValue = labelObj.name.split(':')[1].trim();
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
function getIssuePriceLabel(issue: Issue) {
  let defaultPriceLabel = "Pricing: not set";
  let priceLabels = issue.labels.filter(
    (label) => label.name.includes("Price:") || label.name.includes("Pricing:")
  );
  // NOTICE: we rename "Price" to "Pricing" because the bot removes all manually added price labels starting with "Price:"
  return priceLabels.length > 0
    ? priceLabels[0].name.replace("Price", "Pricing")
    : defaultPriceLabel;
}

/**
 * Returns owner and repository names from a project URL
 * @param projectUrl project URL
 * @returns array of owner and repository names
 */
function getRepoCredentials(projectUrl: string) {
  const urlObject = new URL(projectUrl);
  const urlPath = urlObject.pathname.split('/');
  const ownerName = urlPath[1];
  const repoName = urlPath[2];
  return [ownerName, repoName];
}
