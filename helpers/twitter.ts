import { TwitterApi } from 'twitter-api-v2';
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
  client: twitterClient,
};

async function postTweet(status: string) {
  try {
    const { data } = await twitterClient.v2.tweet(status);
    console.log(`Tweet posted successfully, id: ${data.id}, text: ${data.text}`);
  } catch (error) {
    console.error("Error posting tweet", error);
  }
}
