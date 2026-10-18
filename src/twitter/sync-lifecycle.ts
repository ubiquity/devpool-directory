import type { TwitterApi } from "twitter-api-v2";
import type { PartnerIssue } from "../artifacts/types";
import { deleteTweet, postTweet } from "./lifecycle";

export type TwitterPending = Record<string, PartnerIssue>;
type Counts = { created: number; deleted: number };

export async function applyTwitterLifecycle(opts: {
  client: TwitterApi | undefined;
  pending: TwitterPending;
  twitterMap: Record<string, string>;
  tweetOnCreate: boolean;
  deleteOnComplete: boolean;
  persist: (map: Record<string, string>, pending: TwitterPending, counts: Counts) => Promise<void>;
}) {
  const counts = { created: 0, deleted: 0 };
  for (const [nodeId, issue] of Object.entries(opts.pending)) {
    let tweetId: string | null = null;
    if (issue.state === "open" && opts.tweetOnCreate && !opts.twitterMap[nodeId]) {
      const priceLabel = issue.labels.find((label) => /^Price:/.test(label));
      if (!priceLabel) continue;
      const timeLabel = issue.labels.find((label) => label.startsWith("Time:"));
      const text = `${priceLabel.replace(/^Price:\s*/, "")} for ${timeLabel?.replace(/^Time:\s*/, "") ?? "this task"}\n\n${issue.url}`;
      tweetId = await postTweet(opts.client, text);
      if (!tweetId) continue;
      opts.twitterMap[nodeId] = tweetId;
      counts.created++;
    } else if (issue.state === "closed" && opts.deleteOnComplete && opts.twitterMap[nodeId]) {
      tweetId = opts.twitterMap[nodeId];
      if (!await deleteTweet(opts.client, tweetId)) continue;
      delete opts.twitterMap[nodeId];
      counts.deleted++;
    } else {
      continue;
    }
    delete opts.pending[nodeId];
    try {
      await opts.persist({ ...opts.twitterMap }, { ...opts.pending }, { ...counts });
    } catch (cause) {
      // Stop before another action. This receipt identifies the external success
      // if storage remains unavailable after its existing bounded commit retries.
      throw new Error(`Twitter receipt persistence failed for source ${nodeId}, tweet ${tweetId}; recover this receipt before retrying Twitter`, { cause });
    }
  }
  return counts;
}
