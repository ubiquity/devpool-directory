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
} from "./helpers/github";

// Function to calculate total rewards from open issues
const calculateTotalRewards = async (issues: GitHubIssue[]) => {
  let totalRewards = 0;
  await issues.forEach((issue) => {
    const labels = issue.labels as {
      id?: number | undefined;
      node_id?: string | undefined;
      url?: string | undefined;
      name?: string | undefined;
      description?: string | null | undefined;
      color?: string | null | undefined;
      default?: boolean | undefined;
    }[];
    if (issue.state === "open" && labels.some((label) => label.name as string)) {
      const priceLabel = labels.find((label) => (label.name as string).includes("Pricing"));
      if (priceLabel) {
        const price = parseInt((priceLabel.name as string).split(":")[1].trim(), 10);
        totalRewards += price;
      }
    }
  });
  return totalRewards;
};

// init octokit
dotenv.config();

/**
 * Main function
 * TODO: retry on rate limit error
 * TODO: handle project deletion
 */
async function main() {
  try {
    // get devpool issues
    const devpoolIssues: GitHubIssue[] = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);

    // Calculate total rewards from open issues
    const totalRewards = calculateTotalRewards(devpoolIssues);

    console.log(totalRewards);

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
        const body = isFork ? projectIssue.html_url.replace("https://github.com", "https://www.github.com") : projectIssue.html_url;

        if (devpoolIssue) {
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
          await twitter.postTweet(socialMediaText);
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
