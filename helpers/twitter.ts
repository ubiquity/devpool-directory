import { TwitterApi } from "twitter-api-v2";
import dotenv from "dotenv";
import { GitHubIssue, GitHubLabel } from "../types/github";
dotenv.config();

// Check for each environment variable
const apiKey = process.env.TWITTER_API_KEY;
const apiKeySecret = process.env.TWITTER_API_KEY_SECRET;
const accessToken = process.env.TWITTER_ACCESS_TOKEN;
const accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
  throw new Error("Twitter environment variables are not set");
}

const twitterClient = new TwitterApi({
  appKey: apiKey,
  appSecret: apiKeySecret,
  accessToken: accessToken,
  accessSecret: accessTokenSecret,
});

export default {
  postTweet,
  deleteTweet,
  client: twitterClient,
};

async function postTweet(status: string) {
  try {
    const { data } = await twitterClient.v2.tweet(status);
    console.log(`Tweet posted successfully, id: ${data.id}, text: ${data.text}`);
    return data;
  } catch (error) {
    console.error("Error posting tweet", error);
  }
}

async function deleteTweet(id: string) {
  try {
    const { data } = await twitterClient.v2.deleteTweet(id);
    if (data?.deleted) {
      console.log(`Successfully deleted tweet, id: ${id}`);
    } else {
      console.log(`Couldnt delete tweet, id ${id}`);
    }
  } catch (error) {
    console.error("Error deleting tweet", error);
  }
}

/**
 * Returns text for social media (twitter, telegram, etc...)
 * @param issue Github issue data
 * @returns Social media text
 * Example:
 * ```
 * 50 USD for <1 Hour
 *
 * https://github.com/ubiquity/pay.ubq.fi/issues/65
 * ```
 */
export function getSocialMediaText(issue: GitHubIssue): string {
  const labels = issue.labels as GitHubLabel[];
  const priceLabel = labels.find((label) => label.name.includes("Pricing: "))?.name.replace("Pricing: ", "");
  const timeLabel = labels.find((label) => label.name.includes("Time: "))?.name.replace("Time: ", "");
  // `issue.body` contains URL to the original issue in partner's project
  // while `issue.html_url` contains URL to the mirrored issue from the devpool directory
  return `${priceLabel} for ${timeLabel}\n\n${issue.body}`;
}
