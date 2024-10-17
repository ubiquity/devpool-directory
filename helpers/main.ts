import { Statistics } from "../types/statistics";
import { calculateStatistics } from "./directory/calculate-statistics";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue } from "./directory/directory";
import { getAllIssues } from "./directory/get-all-issues";
import { getPartnerUrls as getPartnerRepoUrls } from "./directory/get-partner-urls";
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
