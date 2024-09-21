import { GitHubIssue, LABELS, GitHubLabel } from "../types/github";
import { octokit, projects } from "./github";
import { getRepoCredentials } from "./repos";

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