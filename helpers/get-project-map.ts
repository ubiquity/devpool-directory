import { GitHubIssue } from "../types/github";
import { getRepoCredentials } from "./repos";

export async function getProjectMap(devpoolIssues: GitHubIssue[], allProjectIssues: GitHubIssue[]) {
  console.log("All Project Partner Repos: ", [...new Set(allProjectIssues.map((issue) => getRepoCredentials(issue.html_url).join("/")))]);
  // create a map of all project issues with their node IDs
  const projectMap = new Map(allProjectIssues.map((issue) => [issue.node_id.trim(), issue]));

  console.log(`Found ${projectMap.size} project issues in total`);
  console.log(`Found ${devpoolIssues.length} devpool issues in total`);

  return projectMap;
}
