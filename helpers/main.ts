import { Statistics } from "../types/statistics";
import { calculateStatistics, DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, getAllIssues, getPartnerUrls as getPartnerRepoUrls, GitHubIssue } from "./directory";
import { commitStatistics, commitTasks } from "./git";
import { initializeTwitterMap, TwitterMap } from "./initialize-twitter-map";
import { syncPartnerRepoIssues } from "./sync-partner-repo-issues";

export async function main() {
  const results: GitHubIssue[] = [];
  const twitterMap: TwitterMap = await initializeTwitterMap();

  const directoryIssues: GitHubIssue[] = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);
  const partnerRepoUrls = await getPartnerRepoUrls();

  // for each project URL
  for (const partnerRepoUrl of partnerRepoUrls) {
    // get owner and repository names from project URL
    const result: GitHubIssue[] = await syncPartnerRepoIssues({ partnerRepoUrl, directoryIssues, twitterMap });
    results.push(...result);
  }

  console.trace(results);
  await commitTasks(results);

  // Calculate total rewards from devpool issues
  const { rewards, tasks } = await calculateStatistics(await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME));
  const statistics: Statistics = { rewards, tasks };

  await commitStatistics(statistics);
}
