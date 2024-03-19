import dotenv from "dotenv";
import twitter from "./helpers/twitter";
import {
  DEVPOOL_OWNER_NAME,
  DEVPOOL_REPO_NAME,
  forceCloseMissingIssues,
  getAllIssues,
  getDevpoolIssueLabels,
  getIssueByLabel,
  getProjectUrls,
  getRepoCredentials,
  getSocialMediaText,
  GitHubIssue,
  GitHubLabel,
  checkIfForked,
  LABELS,
  octokit,
  calculateStatistics,
  writeTotalRewardsToGithub,
} from "./helpers/github";
import { readFile, writeFile } from "fs/promises";
import { Statistics } from "./types/statistics";
// init octokit
dotenv.config();

/**
 * Main function
 * TODO: retry on rate limit error
 * TODO: handle project deletion
 */
async function main() {
  let twitterMap: { [key: string]: string } = {};
  try {
    twitterMap = JSON.parse(await readFile("./twitterMap.json", "utf8"));
  } catch (error) {
    console.log("Couldnt find twitter map artifact, creating a new one");
    await writeFile("./twitterMap.json", JSON.stringify({}));
  }

  try {
    // get devpool issues
    const devpoolIssues: GitHubIssue[] = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);

    // Calculate total rewards from open issues
    const { rewards, tasks } = await calculateStatistics(devpoolIssues);
    const statistics: Statistics = { rewards, tasks };

    await writeTotalRewardsToGithub(statistics);

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

        // adding wwww creates a link to an issue that does not count as a mention
        // helps with preventing a mention in partner's repo especially during testing
        const body = isFork ? projectIssue.html_url.replace("https://github.com", "https://www.github.com") : projectIssue.html_url;

        if (devpoolIssue) {
          if (projectIssue.state == "closed") {
            if (twitterMap[devpoolIssue.node_id]) {
              await twitter.deleteTweet(twitterMap[devpoolIssue.node_id]);
              delete twitterMap[devpoolIssue.node_id];
              await writeFile("./twitterMap.json", JSON.stringify(twitterMap));
            }
          }

          // If project issue doesn't have the "Price" label (i.e. it has been removed) then close
          // the devpool issue if it is not already closed, no need to pollute devpool repo with draft issues
          if (!(projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE))) {
            if (devpoolIssue.state === "open") {
              await octokit.rest.issues.update({
                owner: DEVPOOL_OWNER_NAME,
                repo: DEVPOOL_REPO_NAME,
                issue_number: devpoolIssue.number,
                state: "closed",
              });
              console.log(`Closed (price label not set): ${devpoolIssue.html_url} (${projectIssue.html_url})`);
            } else {
              console.log(`Already closed (price label not set): ${devpoolIssue.html_url} (${projectIssue.html_url})`);
            }
            continue;
          }

          // if the project issue is assigned to someone and it's open in the devpool, then close it
          if (projectIssue.assignee?.login && devpoolIssue.state === "open") {
            await octokit.rest.issues.update({
              owner: DEVPOOL_OWNER_NAME,
              repo: DEVPOOL_REPO_NAME,
              issue_number: devpoolIssue.number,
              state: "closed",
            });
            console.log(`Closed (assigned): ${devpoolIssue.html_url} (${projectIssue.html_url})`);
            continue;
          }

          // if the project issue is not assigned to someone and it's closed in the devpool, then reopen it
          if (!projectIssue.assignee?.login && projectIssue.state === "open" && devpoolIssue.state === "closed") {
            await octokit.rest.issues.update({
              owner: DEVPOOL_OWNER_NAME,
              repo: DEVPOOL_REPO_NAME,
              issue_number: devpoolIssue.number,
              state: "open",
            });
            console.log(`Reopened (unassigned): ${devpoolIssue.html_url} (${projectIssue.html_url})`);
            continue;
          }

          // prepare for issue updating
          const isDevpoolUnavailableLabel = (devpoolIssue.labels as GitHubLabel[])?.some((label) => label.name === LABELS.UNAVAILABLE);
          const devpoolIssueLabelsStringified = (devpoolIssue.labels as GitHubLabel[])
            .map((label) => label.name)
            .sort()
            .toString();
          const projectIssueLabelsStringified = getDevpoolIssueLabels(projectIssue, projectUrl).sort().toString();

          // Update devpool issue if any of the following has been updated:
          // - issue title
          // - issue state (open/closed)
          // - assignee (exists or not)
          // - repository name (devpool issue body contains a partner project issue URL)
          // - any label
          if (
            devpoolIssue.title !== projectIssue.title ||
            devpoolIssue.state !== projectIssue.state ||
            (!isDevpoolUnavailableLabel && projectIssue.assignee?.login) ||
            (isDevpoolUnavailableLabel && !projectIssue.assignee?.login) ||
            devpoolIssue.body !== projectIssue.html_url ||
            devpoolIssueLabelsStringified !== projectIssueLabelsStringified
          ) {
            await octokit.rest.issues.update({
              owner: DEVPOOL_OWNER_NAME,
              repo: DEVPOOL_REPO_NAME,
              issue_number: devpoolIssue.number,
              title: projectIssue.title,
              body,
              state: projectIssue.state as "open" | "closed",
              labels: getDevpoolIssueLabels(projectIssue, projectUrl),
            });
            console.log(`Updated: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
          } else {
            console.log(`No updates: ${devpoolIssue.html_url} (${projectIssue.html_url})`);
          }
        } else {
          // issue does not exist in devpool
          // if issue is "closed" then skip it, no need to copy/paste already "closed" issues
          if (projectIssue.state === "closed") continue;
          // if issue doesn't have the "Price" label then skip it, no need to pollute repo with draft issues
          if (!(projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE))) continue;
          // if the project issue is assigned to someone, then skip it
          if (projectIssue.assignee?.login) continue;

          // create a new issue
          const createdIssue = await octokit.rest.issues.create({
            owner: DEVPOOL_OWNER_NAME,
            repo: DEVPOOL_REPO_NAME,
            title: projectIssue.title,
            body,
            labels: getDevpoolIssueLabels(projectIssue, projectUrl),
          });
          console.log(`Created: ${createdIssue.data.html_url} (${projectIssue.html_url})`);

          // post to social media
          const socialMediaText = getSocialMediaText(createdIssue.data);
          const tweetId = await twitter.postTweet(socialMediaText);

          twitterMap[createdIssue.data.node_id] = tweetId?.id ?? "";
          await writeFile("./twitterMap.json", JSON.stringify(twitterMap));
        }
      }
    }

    // close missing issues
    await forceCloseMissingIssues(devpoolIssues, allProjectIssues);
  } catch (err) {
    console.error(err);
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error(error);
  }
})();

// Expose the main only for testing purposes
if (process.env.NODE_ENV === "test") {
  exports.main = main;
}
