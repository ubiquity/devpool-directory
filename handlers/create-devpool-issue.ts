import { writeFile } from "fs/promises";
import { TwitterMap } from "..";
import { getDevpoolIssueLabels } from "../helpers/issue";
import twitter, { getSocialMediaText } from "../helpers/twitter";
import { octokit, DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME } from "../helpers/github";
import { GitHubIssue, GitHubLabel, LABELS } from "../types/github";

export async function createDevPoolIssue(projectIssue: GitHubIssue, projectUrl: string, body: string, twitterMap: TwitterMap) {
    // if issue is "closed" then skip it, no need to copy/paste already "closed" issues
    if (projectIssue.state === "closed") return;

    // if the project issue is assigned to someone, then skip it
    if (projectIssue.assignee) return;

    // if issue doesn't have the "Price" label then skip it, no need to pollute repo with draft issues
    if (!(projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE))) return;

    // create a new issue
    try {
        const createdIssue = await octokit.rest.issues.create({
            owner: DEVPOOL_OWNER_NAME,
            repo: DEVPOOL_REPO_NAME,
            title: projectIssue.title,
            body,
            labels: getDevpoolIssueLabels(projectIssue, projectUrl),
        });
        console.log(`Created: ${createdIssue.data.html_url} (${projectIssue.html_url})`);

        if (!createdIssue) {
            console.log("No new issue to tweet about");
            return;
        }

        // post to social media
        try {
            const socialMediaText = getSocialMediaText(createdIssue.data);
            const tweetId = await twitter.postTweet(socialMediaText);

            twitterMap[createdIssue.data.node_id] = tweetId?.id ?? "";
            await writeFile("./twitterMap.json", JSON.stringify(twitterMap));
        } catch (err) {
            console.error("Failed to post tweet: ", err);
        }
    } catch (err) {
        console.error("Failed to create new issue: ", err);
        return;
    }
}
