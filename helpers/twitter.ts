import { TwitterApi } from "twitter-api-v2";
import dotenv from "dotenv";
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
      console.log(`Could not delete tweet, id ${id}`);
    }
  } catch (error) {
    console.error("Error deleting tweet", error);
  }
}
