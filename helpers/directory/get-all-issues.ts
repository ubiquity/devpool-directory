import { GitHubIssue, octokit } from "./directory";

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
