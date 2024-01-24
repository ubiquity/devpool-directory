import Twitter from "twitter";
import dotenv from "dotenv";
dotenv.config();
// Check for each environment variable
const consumerKey = process.env.TWITTER_CONSUMER_KEY;
const consumerSecret = process.env.TWITTER_CONSUMER_SECRET;
const accessTokenKey = process.env.TWITTER_ACCESS_TOKEN_KEY;
const accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

if (!consumerKey || !consumerSecret || !accessTokenKey || !accessTokenSecret) {
  throw new Error("Twitter environment variables are not set");
}

const twitterClient = new Twitter({
  consumer_key: consumerKey,
  consumer_secret: consumerSecret,
  access_token_key: accessTokenKey,
  access_token_secret: accessTokenSecret,
});

export default {
  postTweet,
  client: twitterClient,
};

async function postTweet(status: string) {
  try {
    await twitterClient.post("statuses/update", { status });
    console.log("Tweet posted successfully");
  } catch (error) {
    console.error("Error posting tweet", error);
  }
}
