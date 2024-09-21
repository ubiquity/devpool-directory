import { handleNodeIdMismatches } from "../handlers/handle-node-id-mismatch";
import { GitHubIssue } from "../types/github";
import { getIssueByLabel } from "./issue";
import { getRepoCredentials } from "./repos";

export async function getProjectMap(devpoolIssues: GitHubIssue[], allProjectIssues: GitHubIssue[]) {
  console.log("All Project Partner Repos: ", [...new Set(allProjectIssues.map((issue) => getRepoCredentials(issue.html_url).join("/")))]);
  // create a map of all project issues with their node IDs
  const projectMap = new Map(allProjectIssues.map((issue) => [issue.node_id.trim(), issue]));

  console.log(`Found ${projectMap.size} project issues in total`);
  console.log(`Found ${devpoolIssues.length} devpool issues in total`);


  // a set of extracted node IDs from devpool issues that are not found in the project map
  const missingPartnerTasks = new Set<string>();
  const deletedPartnerTasks = new Set<string>();

  // align any devpool issues which have node ID labels that do not match the project issue
  for (const devpoolIssue of devpoolIssues) {
    await handleNodeIdMismatches(devpoolIssue, projectMap, devpoolIssues, missingPartnerTasks, deletedPartnerTasks);
  }

  if (missingPartnerTasks.size > 0) {
    console.log(`There are ${missingPartnerTasks.size} missing partner tasks`, {
      missingPartnerTasks: [...missingPartnerTasks],
      missingPartnerUrls: [...missingPartnerTasks].map(partnerTaskId => getIssueByLabel(devpoolIssues, `id: ${partnerTaskId}`)?.html_url)
    });
  }

  if (deletedPartnerTasks.size > 0) {
    console.log(`There are ${deletedPartnerTasks.size} deleted partner tasks`, {
      deletedPartnerTasks: [...deletedPartnerTasks],
      deletedPartnerUrls: [...deletedPartnerTasks].map(partnerTaskId => getIssueByLabel(devpoolIssues, `id: ${partnerTaskId}`)?.html_url)
    });
  }


  return projectMap;
}
