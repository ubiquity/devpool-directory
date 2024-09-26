import { Statistics } from "../types/statistics";
import { commitRewards, commitTasks } from "./git";
import {
  calculateStatistics,
  checkIfForked,
  DEVPOOL_OWNER_NAME,
  DEVPOOL_REPO_NAME,
  getAllIssues,
  getPartnerUrls as getPartnerRepoUrls,
  GitHubIssue,
} from "./github";
import { initializeTwitterMap, TwitterMap } from "./initialize-twitter-map";
import { syncPartnerRepoIssues } from "./sync-partner-repo-issues";

export async function main() {
  const allFullIssues: GitHubIssue[] = [];
  const isFork = await checkIfForked(DEVPOOL_OWNER_NAME);
  const twitterMap: TwitterMap = await initializeTwitterMap();

  const directoryPreviewIssues: GitHubIssue[] = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);
  const partnerRepoUrls = await getPartnerRepoUrls();

  // for each project URL
  for (const partnerRepoUrl of partnerRepoUrls) {
    // get owner and repository names from project URL
    await syncPartnerRepoIssues({ partnerRepoUrl, isFork, directoryPreviewIssues, allFullIssues, twitterMap });
  }

  console.trace(allFullIssues);
  await commitTasks(allFullIssues);

  // Calculate total rewards from devpool issues
  const { rewards, tasks } = await calculateStatistics(await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME));
  const statistics: Statistics = { rewards, tasks };

  await commitRewards(statistics);
}
