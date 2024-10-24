import { twitterClient } from "./twitter";

export async function postTweet(status: string) {
  if (twitterClient) {
    try {
      const { data } = await twitterClient.v2.tweet(status);
      console.log(`Tweet posted successfully, id: ${data.id}, text: ${data.text}`);
      return data;
    } catch (error) {
      console.error("Error posting tweet", error);
    }
  } else {
    console.log("Skipping posting a tweet due to missing env variables");
  }
}
