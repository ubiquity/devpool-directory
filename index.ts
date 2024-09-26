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

  // get devpool issues
  const devpoolIssues: GitHubIssue[] = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);

  // aggregate projects.urls and opt settings
  const projectUrls = await getProjectUrls();

  // aggregate all project issues
  const allProjectIssues: GitHubIssue[] = [];

  const isFork = await checkIfForked(DEVPOOL_OWNER_NAME);

  // for each project URL
  for (const projectUrl of projectUrls) {
    // get owner and repository names from project URL
    const [ownerName, repoName] = getRepoCredentials(projectUrl);
    // get all project issues (opened and closed)
    const projectIssues: GitHubIssue[] = await getAllIssues(ownerName, repoName);
    // aggregate all project issues
    allProjectIssues.push(...projectIssues);
    // for all issues
    for (const projectIssue of projectIssues) {
      // if issue exists in devpool
      const devpoolIssue = getIssueByLabel(devpoolIssues, `id: ${projectIssue.node_id}`);

      // adding www creates a link to an issue that does not count as a mention
      // helps with preventing a mention in partner's repo especially during testing
      const body = isFork ? projectIssue.html_url.replace("https://github.com", "https://www.github.com") : projectIssue.html_url;

      // for all issues
      if (devpoolIssue) {
        // if it exists in the devpool, then update it
        await handleDevPoolIssue(projectIssues, projectIssue, projectUrl, devpoolIssue, isFork);
      } else {
        // if it doesn't exist in the devpool, then create it
        await createDevPoolIssue(projectIssue, projectUrl, body, twitterMap);
      }

      // precompile all issues into a single json file
      await commitTasks(allProjectIssues);
    }
  }

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
