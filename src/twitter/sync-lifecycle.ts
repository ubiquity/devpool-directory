import { ApiResponseError, type TwitterApi } from "twitter-api-v2";
import type { PartnerIssue } from "../artifacts/types";

type CreateAttempt = { accountId: string; startedAtISO: string; sourceUrl: string };
export type TwitterPending = Record<string, PartnerIssue & { createAttempt?: CreateAttempt; cleanupOnly?: boolean }>;
type Counts = { created: number; deleted: number };

function canonicalUrl(value: string | undefined) {
  const match = /^https:\/\/(?:www\.)?github\.com\/([^/\s?#]+\/[^/\s?#]+\/issues\/\d+)\/?$/.exec(value ?? "");
  return match ? `https://github.com/${match[1]}` : null;
}

function rejectedPost(error: unknown): error is ApiResponseError {
  return error instanceof ApiResponseError && [400, 401, 403, 404, 422, 429].includes(error.code) &&
    !error.hasErrorCode(187) && !/duplicat/i.test(JSON.stringify(error.data));
}

async function recoverAttempt(client: TwitterApi, attempt: CreateAttempt, accountId: string) {
  const start = Date.parse(attempt.startedAtISO);
  const end = Date.now();
  const sourceUrl = canonicalUrl(attempt.sourceUrl);
  if (accountId !== attempt.accountId || !sourceUrl || !Number.isFinite(start) || start > end) throw new Error("invalid Twitter attempt identity");
  const timeline = await client.v2.userTimeline(accountId, {
    start_time: attempt.startedAtISO, end_time: new Date(end).toISOString(), max_results: 100,
    exclude: ["replies", "retweets"], "tweet.fields": ["created_at", "author_id", "entities"]
  });
  const matches = new Set<string>();
  let scanned = 0;
  for await (const tweet of timeline) {
    const created = Date.parse(tweet.created_at ?? "");
    if (!tweet.author_id || !Number.isFinite(created)) throw new Error("incomplete Twitter recovery metadata");
    if (tweet.author_id === accountId && created >= start && created <= end && tweet.entities?.urls?.some((url) =>
      canonicalUrl(url.expanded_url) === sourceUrl || canonicalUrl(url.unwound_url) === sourceUrl)) {
      if (!tweet.id) throw new Error("Twitter recovery receipt has no ID");
      matches.add(tweet.id);
    }
    if (++scanned === 1000) break;
  }
  if (timeline.done !== true || timeline.errors.length || matches.size !== 1) throw new Error("Twitter recovery did not establish one complete receipt");
  return [...matches][0];
}

export async function applyTwitterLifecycle(opts: {
  client: TwitterApi | undefined;
  pending: TwitterPending;
  twitterMap: Record<string, string>;
  tweetOnCreate: boolean;
  deleteOnComplete: boolean;
  persist: (map: Record<string, string>, pending: TwitterPending, counts: Counts) => Promise<void>;
}) {
  const counts = { created: 0, deleted: 0 };
  const client = opts.client;
  if (!client || (!opts.tweetOnCreate && !opts.deleteOnComplete)) return counts;
  let accountId: string | undefined;
  const account = async () => {
    accountId ??= (await client.v2.me()).data.id;
    if (!accountId) throw new Error("cannot identify authenticated Twitter account");
    return accountId;
  };
  const save = () => opts.persist({ ...opts.twitterMap }, { ...opts.pending }, { ...counts });
  const receipt = async (nodeId: string, tweetId: string) => {
    try { await save(); }
    catch (cause) { throw new Error(`Twitter receipt persistence failed for source ${nodeId}, tweet ${tweetId}; durable attempt will require recovery`, { cause }); }
  };
  for (const [nodeId, pending] of Object.entries(opts.pending)) {
    let issue = pending;
    if (issue.createAttempt) {
      let recoveredId: string;
      try { recoveredId = await recoverAttempt(client, issue.createAttempt, await account()); }
      catch (cause) { throw new Error(`unresolved Twitter creation for source ${nodeId}; refusing to repost`, { cause }); }
      opts.twitterMap[nodeId] = recoveredId;
      const { createAttempt: _attempt, ...resolved } = issue;
      issue = resolved;
      if (issue.cleanupOnly || issue.state === "closed") opts.pending[nodeId] = issue;
      else delete opts.pending[nodeId];
      await receipt(nodeId, recoveredId);
    }
    if ((issue.cleanupOnly || issue.state === "closed") && opts.deleteOnComplete && opts.twitterMap[nodeId]) {
      const tweetId = opts.twitterMap[nodeId];
      try { if (!(await client.v2.deleteTweet(tweetId)).data.deleted) continue; }
      catch (error) { if (!(error instanceof ApiResponseError) || error.code !== 404) continue; }
      delete opts.twitterMap[nodeId];
      delete opts.pending[nodeId];
      counts.deleted++;
      await receipt(nodeId, tweetId);
    } else if (!issue.cleanupOnly && issue.state === "open" && opts.tweetOnCreate && !opts.twitterMap[nodeId]) {
      const priceLabel = issue.labels.find((label) => /^Price:/.test(label));
      if (!priceLabel) continue;
      const timeLabel = issue.labels.find((label) => label.startsWith("Time:"));
      const text = `${priceLabel.replace(/^Price:\s*/, "")} for ${timeLabel?.replace(/^Time:\s*/, "") ?? "this task"}\n\n${issue.url}`;
      const sourceUrl = canonicalUrl(issue.url);
      if (!sourceUrl) throw new Error(`invalid Twitter source URL: ${nodeId}`);
      opts.pending[nodeId] = { ...issue, createAttempt: { accountId: await account(),
        startedAtISO: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(), sourceUrl } };
      await save();
      let tweetId: string;
      try {
        tweetId = (await client.v2.tweet(text)).data.id;
        if (!tweetId) throw new Error("Twitter response has no receipt ID");
      } catch (cause) {
        if (rejectedPost(cause)) {
          opts.pending[nodeId] = issue;
          await save();
          console.warn(`[twitter] post rejected (${cause.code}); retaining candidate`);
          continue;
        }
        throw new Error(`ambiguous Twitter creation for source ${nodeId}; retaining durable attempt`, { cause });
      }
      opts.twitterMap[nodeId] = tweetId;
      delete opts.pending[nodeId];
      counts.created++;
      await receipt(nodeId, tweetId);
    }
  }
  return counts;
}
