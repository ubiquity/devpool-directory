import { twitterClient } from "./twitter";

export async function deleteTweet(id: string) {
  if (twitterClient) {
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
  } else {
    console.log("Skipping deleting a tweet due to missing env variables");
  }
}
