import { calculateStatistics } from "./directory/calculate-statistics";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue } from "./directory/directory";
import { getPartnerUrls as getPartnerRepoUrls } from "./directory/get-partner-urls";
import { getRepositoryIssues } from "./directory/get-repository-issues";
import { Statistics } from "./directory/statistics";
import { syncPartnerRepoIssues } from "./directory/sync-partner-repo-issues";
import { commitStatistics, commitTasks } from "./git";
import { initializeTwitterMap, TwitterMap } from "./twitter/initialize-twitter-map";

export async function main() {
  const twitterMap: TwitterMap = await initializeTwitterMap();
  const directoryIssues: GitHubIssue[] = await getRepositoryIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);
  const partnerRepoUrls = await getPartnerRepoUrls();
  const taskList: GitHubIssue[] = [];

  // for each project URL
  for (const partnerRepoUrl of partnerRepoUrls) {
    // get owner and repository names from project URL
    const result: GitHubIssue[] = await syncPartnerRepoIssues({ partnerRepoUrl, directoryIssues, twitterMap });
    taskList.push(...result);
  }

  await commitTasks(taskList);

  // Calculate total rewards from devpool issues
  const { rewards, tasks } = await calculateStatistics(await getRepositoryIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME));
  const statistics: Statistics = { rewards, tasks };

  await commitStatistics(statistics);
}
