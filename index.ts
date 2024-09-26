import dotenv from "dotenv";
import { readFile } from "fs/promises";
import { commitRewards, commitTasks, commitTwitterMap, gitPush } from "./helpers/git";
import {
  calculateStatistics,
  checkIfForked,
  createDevPoolIssue,
  DEVPOOL_OWNER_NAME,
  DEVPOOL_REPO_NAME,
  getAllIssues,
  getIssueByLabel,
  getProjectUrls,
  getRepoCredentials,
  GitHubIssue,
  handleDevPoolIssue,
} from "./helpers/github";
import { Statistics } from "./types/statistics";
// init octokit
dotenv.config();

export type TwitterMap = Record<string, string>;

/**
 * Main function
 * TODO: retry on rate limit error
 * TODO: handle project deletion
 */
async function main() {
  let twitterMap: TwitterMap = {};
  try {
    twitterMap = JSON.parse(await readFile("./twitter-map.json", "utf8"));
  } catch (error) {
    console.log("Couldn't find twitter map artifact, creating a new one");
    await commitTwitterMap(twitterMap);
  }

  // these are just the "preview" issues from the directory which point to the "full" issues.
  const directoryPreviewIssues: GitHubIssue[] = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);

  // aggregate projects.urls and opt settings
  const projectUrls = await getProjectUrls();

  // aggregate all project issues
  const allFullIssues: GitHubIssue[] = [];

  const isFork = await checkIfForked(DEVPOOL_OWNER_NAME);

  // for each project URL
  for (const projectUrl of projectUrls) {
    // get owner and repository names from project URL
    const [ownerName, repoName] = getRepoCredentials(projectUrl);
    // get all remote "full" issues (opened and closed)
    const previewIssuesPerPartnerRepo: GitHubIssue[] = await getAllIssues(ownerName, repoName);
    // aggregate all project issues

    // for all issues
    for (const previewIssuePerPartnerRepo of previewIssuesPerPartnerRepo) {
      // if issue exists in devpool
      const remoteFullIssue = getIssueByLabel(directoryPreviewIssues, `id: ${previewIssuePerPartnerRepo.node_id}`);

      // adding www creates a link to an issue that does not count as a mention
      // helps with preventing a mention in partner's repo especially during testing
      const body = isFork ? previewIssuePerPartnerRepo.html_url.replace("https://github.com", "https://www.github.com") : previewIssuePerPartnerRepo.html_url;

      // for all issues
      if (remoteFullIssue) {
        // if it exists in the devpool, then update it
        await handleDevPoolIssue(previewIssuesPerPartnerRepo, previewIssuePerPartnerRepo, projectUrl, remoteFullIssue, isFork);
        allFullIssues.push(remoteFullIssue);
      } else {
        // if it doesn't exist in the devpool, then create it
        await createDevPoolIssue(previewIssuePerPartnerRepo, projectUrl, body, twitterMap);
      }
    }
  }

  console.trace(allFullIssues);
  await commitTasks(allFullIssues);

  // Calculate total rewards from devpool issues
  const { rewards, tasks } = await calculateStatistics(await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME));
  const statistics: Statistics = { rewards, tasks };

  await commitRewards(statistics);
}

async function runMainAndPush() {
  try {
    await main();
  } catch (error) {
    console.error("Error in main execution:", error);
  }

  try {
    await gitPush();
  } catch (error) {
    console.error("Error during git push:", error);
  }
}

runMainAndPush().catch((error) => {
  console.error("Unhandled error in runMainAndPush:", error);
  process.exit(1);
});
