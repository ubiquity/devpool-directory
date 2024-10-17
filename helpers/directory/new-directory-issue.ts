import { commitTwitterMap } from "../git";
import { TwitterMap } from "../initialize-twitter-map";
import twitter from "../twitter";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue, GitHubLabel, LABELS, octokit } from "./directory";
import { getDirectoryIssueLabelsFromPartnerIssue } from "./get-directory-issue-labels";
import { getSocialMediaText } from "./get-social-media-text";

export async function newDirectoryIssue(partnerIssue: GitHubIssue, projectUrl: string, body: string, twitterMap: TwitterMap) {
  // if issue is "closed" then skip it, no need to copy/paste already "closed" issues
  if (partnerIssue.state === "closed") return;

  // if the project issue is assigned to someone, then skip it
  if (partnerIssue.assignee) return;

  // check if the issue is the same type as it should be
  const hasPriceLabel = (partnerIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE));

  // create a new issue
  try {
    const createdIssue = await octokit.rest.issues.create({
      owner: DEVPOOL_OWNER_NAME,
      repo: DEVPOOL_REPO_NAME,
      title: partnerIssue.title,
      body,
      labels: getDirectoryIssueLabelsFromPartnerIssue(partnerIssue),
    });
    console.log(`Created: ${createdIssue.data.html_url} (${partnerIssue.html_url})`);

    if (!createdIssue) {
      console.log("No new issue to tweet about");
      return;
    }

    // post to social media (only if it's not a proposal)
    if (hasPriceLabel) {
      try {
        const socialMediaText = getSocialMediaText(createdIssue.data);
        const tweetId = await twitter.postTweet(socialMediaText);

        if (tweetId) {
          twitterMap[createdIssue.data.node_id] = tweetId?.id ?? "";
          await commitTwitterMap(twitterMap);
        }
      } catch (err) {
        console.error("Failed to post tweet: ", err);
      }
    }
  } catch (err) {
    console.error("Failed to create new issue:", {
      partnerIssueTitle: partnerIssue.title,
      partnerIssueUrl: partnerIssue.html_url,
      projectUrl,
      error: err.message,
    });
    return;
  }
}
