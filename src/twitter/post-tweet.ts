import { twitterClient } from "./twitter";

export async function postTweet(status: string) {
  try {
    const { data } = await twitterClient.v2.tweet(status);
    console.log(`Tweet posted successfully, id: ${data.id}, text: ${data.text}`);
    return data;
  } catch (error) {
    console.error("Error posting tweet", error);
  }
}
