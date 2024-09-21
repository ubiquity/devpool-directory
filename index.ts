import dotenv from "dotenv";
import { DEVPOOL_OWNER_NAME } from "./helpers/github";
import { readFile, writeFile } from "fs/promises";
import { Statistics } from "./types/statistics";
import { createDevPoolIssue } from "./handlers/create-devpool-issue";
import { handleDevPoolIssue } from "./handlers/handle-devpool-issue";
import { getAllIssues, getIssueByLabel, getIssueLabelValue } from "./helpers/issue";
import { getProjectUrls, getRepoCredentials } from "./helpers/repos";
import { calculateStatistics, writeTotalRewardsToGithub } from "./helpers/statistics";
import { checkIfForked } from "./helpers/utils";
import { GitHubIssue } from "./types/github";
import { getAllDevpoolIssues } from "./helpers/get-all-devpool-issues";
import { getProjectMap } from "./helpers/get-project-map";
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
    twitterMap = JSON.parse(await readFile("./twitterMap.json", "utf8"));
  } catch (error) {
    console.log("Couldnt find twitter map artifact, creating a new one");
    await writeFile("./twitterMap.json", JSON.stringify({}));
  }

  // aggregate projects.urls and opt settings
  const projectUrls = await getProjectUrls();

  // get devpool issues
  const devpoolIssues: GitHubIssue[] = await getAllDevpoolIssues(projectUrls);

  // aggregate all project issues
  const allProjectIssues: GitHubIssue[] = [];

  // check if the devpool is a fork
  // (if this _is_ a fork, update your DEVPOOL_OWNER_NAME to your org name)
  const isFork = await checkIfForked(DEVPOOL_OWNER_NAME);

  // for each project URL
  for (const projectUrl of projectUrls) {
    // get owner and repository names from project URL
    const [ownerName, repoName] = getRepoCredentials(projectUrl);
    // get all project issues (opened and closed)
    const projectIssues: GitHubIssue[] = await getAllIssues(ownerName, repoName);
    // aggregate all project issues
    allProjectIssues.push(...projectIssues);
  }

  const projectMap = await getProjectMap(devpoolIssues, allProjectIssues);

  // for all issues
  for (const projectIssue of projectMap.values()) {
    // if issue exists in devpool
    const devpoolIssue = getIssueByLabel(devpoolIssues, `id: ${projectIssue.node_id}`);
    const projectHtmlUrl = projectIssue.html_url;
    const ownerRepo = getRepoCredentials(projectHtmlUrl).join("/");

    // adding www creates a link to an issue that does not count as a mention
    // helps with preventing a mention in partner's repo especially during testing
    const body = isFork ? projectHtmlUrl.replace("https://github.com", "https://www.github.com") : projectHtmlUrl;

    // for all issues
    if (devpoolIssue) {
      const partnerTaskId = getIssueLabelValue(devpoolIssue, "id:");
      const isMissingInPartners = partnerTaskId ? !projectMap.has(partnerTaskId) : true;

      if (isMissingInPartners) {
        console.log(`Partner task not found in project map`, {
          partnerTaskId,
          projectIssue: projectHtmlUrl,
          devpoolIssue: devpoolIssue.html_url,
        });
      }

      // if it exists in the devpool, then update it
      await handleDevPoolIssue(isMissingInPartners, projectIssue, ownerRepo, devpoolIssue, isFork);
    } else {
      // if it doesn't exist in the devpool, then create it
      await createDevPoolIssue(projectIssue, ownerRepo, body, twitterMap);
    }
  }

  // Calculate total rewards from devpool issues
  const statistics: Statistics = await calculateStatistics(await getAllDevpoolIssues(projectUrls), projectMap);
  console.log("Statistics: ", statistics);

  await writeTotalRewardsToGithub(statistics);
}

void (async () => {
  await main();
})();

// Expose the main only for testing purposes
if (process.env.NODE_ENV === "test") {
  exports.main = main;
}
