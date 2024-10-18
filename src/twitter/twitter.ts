import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";
import { deleteTweet } from "./delete-tweet";
import { postTweet } from "./post-tweet";
dotenv.config();

// Check for each environment variable
const apiKey = process.env.TWITTER_API_KEY;
const apiKeySecret = process.env.TWITTER_API_KEY_SECRET;
const accessToken = process.env.TWITTER_ACCESS_TOKEN;
const accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
  throw new Error("Twitter environment variables are not set");
}

export const twitterClient = new TwitterApi({
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
