/**
 * Syncs issues with partner projects
 */

import { Octokit } from "octokit";
import * as projects from './projects.json';

const DEVPOOL_OWNER_NAME = 'ubiquity';
const DEVPOOL_REPO_NAME = 'devpool-directory';

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
        const devpoolIssues: Issue[] = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);

        // for each project URL
        for (let projectUrl of projects.urls) {
            // get owner and repository names from project URL
            const [ownerName, repoName] = getRepoCredentials(projectUrl);
            // get all project issues (opened and closed)
            const projectIssues: Issue[] = await getAllIssues(ownerName, repoName);
            // for all issues
            for (let projectIssue of projectIssues) {
                // if issue exists in devpool
                const devpoolIssue = getIssueByLabel(devpoolIssues, `id: ${projectIssue.node_id}`);
                if (devpoolIssue) {
                    const issueDetails = await octokit.rest.issues.get({
                        owner: ownerName,
                        repo: repoName,
                        issue_number: devpoolIssue.number,
                    });
                    const additionalLabelsToAdd = issueDetails.data?.assignee ?['Unavailable']:[]
                    // if title or state or pricing was updated then update a devpool issue
                    if (devpoolIssue.title !== projectIssue.title || devpoolIssue.state !== projectIssue.state || getIssuePriceLabel(devpoolIssue) !== getIssuePriceLabel(projectIssue)) {
                        await octokit.rest.issues.update({
                            owner: DEVPOOL_OWNER_NAME,
                            repo: DEVPOOL_REPO_NAME,
                            issue_number: devpoolIssue.number,
                            title: projectIssue.title,
                            state: projectIssue.state,
                            labels: [...getDevpoolIssueLabels(projectIssue, ownerName, repoName),...additionalLabelsToAdd],
                        });
                        console.log(`Updated: ${projectIssue.html_url}`);
                    } else {
                        console.log(`No updates: ${projectIssue.html_url}`);
                    }
                } else {
                    // issue does not exist in devpool
                    // if issue is "closed" then skip it, no need to copy/paste already "closed" issues
                    if (projectIssue.state === 'closed') continue;
                    // create a new issue
                    const issueDetails = await octokit.rest.issues.get({
                        owner: ownerName,
                        repo: repoName,
                        issue_number: projectIssue.number,
                    });
                    const additionalLabelsToAdd = issueDetails.data?.assignee ?['Unavailable']:[]
                    const createdIssue = await octokit.rest.issues.create({
                        owner: DEVPOOL_OWNER_NAME,
                        repo: DEVPOOL_REPO_NAME,
                        title: projectIssue.title,
                        body: projectIssue.html_url,
                        labels: [...getDevpoolIssueLabels(projectIssue, ownerName, repoName),...additionalLabelsToAdd],
                    });
                    console.log(`Created: ${projectIssue.html_url}`);
                }
            }
        }
    } catch (err) {
        console.log(err);
    }
}

main();

//=============
// Helpers
//=============

/**
 * Returns all issues in a repo
 * @param ownerName owner name
 * @param repoName repo name
 * @returns array of issues
 */
async function getAllIssues(ownerName: string, repoName: string) {
    // get all project issues (opened and closed)
    let issues: Issue[] = await octokit.paginate({
        method: 'GET',
        url: `/repos/${ownerName}/${repoName}/issues?state=all`,
    });
    // remove PRs from the project issues
    issues = issues.filter(issue => !issue.pull_request);
    
    return issues;
}

/**
 * Returns array of labels for a devpool issue
 * @param issue issue object
 * @param ownerName owner name
 * @param repoName repo name
 */
function getDevpoolIssueLabels(issue: Issue, ownerName: string, repoName: string) {
    return [
        getIssuePriceLabel(issue), // price
        `Partner: ${ownerName}/${repoName}`, // partner
        `id: ${issue.node_id}`, // id
    ];
}

/**
 * Returns issue by label
 * @param issues issues array
 * @param label label string
 */
function getIssueByLabel(issues: Issue[], label: string) {
    issues = issues.filter(issue => {
        const labels = issue.labels.filter(obj => obj.name === label);
        return labels.length > 0;
    });
    return issues.length > 0 ? issues[0] : null;
}

/**
 * Returns price label from an issue
 * @param issue issue object
 * @returns price label
 */
function getIssuePriceLabel(issue: Issue) {
    let defaultPriceLabel = 'Pricing: not set';
    let priceLabels = issue.labels.filter(label => label.name.includes('Price:') || label.name.includes('Pricing:'));
    // NOTICE: we rename "Price" to "Pricing" because the bot removes all manually added price labels starting with "Price:"
    return priceLabels.length > 0 ? priceLabels[0].name.replace('Price', 'Pricing') : defaultPriceLabel;
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
    const issueNumber = urlPath?.[4];
    return [ownerName, repoName, issueNumber];
}