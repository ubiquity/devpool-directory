import { graphql } from "@octokit/graphql";
import type { Octokit } from "@octokit/rest";
import type { PartnerIssue, PartnerPullRequest } from "./artifacts/types";

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function withBackoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try { return await fn(); } catch (e: any) {
    const status = e?.status ?? e?.response?.status;
    const reset = Number(e?.response?.headers?.["x-ratelimit-reset"]) || 0;
    const retryAfter = Number(e?.response?.headers?.["retry-after"]) || 0;
    if (status === 403 || status === 429) {
      const nowSec = Math.floor(Date.now() / 1000);
      const untilResetMs = reset > nowSec ? (reset - nowSec) * 1000 : 0;
      const base = Math.min(30000, 2000 * Math.pow(2, attempt));
      const wait = Math.max(base, retryAfter * 1000, untilResetMs);
      await sleep(Math.min(wait, 60000));
      return withBackoff(fn, Math.min(attempt + 1, 5));
    }
    throw e;
  } }

function getGql() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  return token ? graphql.defaults({ headers: { authorization: `token ${token}` } }) : graphql;
}

export async function fetchIssuesForRepoGQL(_octokit: Octokit, full: string, sinceISO?: string): Promise<PartnerIssue[]> {
  const [owner, repo] = full.split("/");
  const q = /* GraphQL */ `
    query RepoIssues($owner: String!, $name: String!, $since: DateTime, $after: String) {
      repository(owner: $owner, name: $name) {
        issues(first: 100, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}, filterBy: {since: $since, states: [OPEN, CLOSED]}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            number
            title
            url
            body
            state
            stateReason
            createdAt
            updatedAt
            labels(first: 100) { nodes { name } }
            assignees(first: 10) { nodes { login } }
          }
        }
      }
    }
  `;

  const out: PartnerIssue[] = [];
  const gql = getGql();
  let after: string | undefined;
  const cutoff = sinceISO ? new Date(sinceISO).getTime() : undefined;

  while (true) {
    const res: any = await withBackoff(() => gql(q, { owner, name: repo, since: sinceISO, after }));
    const conn = res?.repository?.issues;
    const nodes: any[] = conn?.nodes ?? [];
    let reachedCutoff = false;
    for (const n of nodes) {
      if (n.state === "CLOSED" && n.stateReason === "NOT_PLANNED") continue;
      // Early stop if ordered by updatedAt DESC and this node is older than cutoff
      if (cutoff !== undefined && n.updatedAt && new Date(n.updatedAt).getTime() < cutoff) {
        reachedCutoff = true;
        break;
      }
      out.push({
        owner,
        repo,
        number: n.number,
        node_id: n.id,
        title: n.title ?? "",
        url: n.url ?? "",
        body: n.body ?? "",
        labels: (n.labels?.nodes ?? []).map((l: any) => l?.name).filter(Boolean),
        assignees: (n.assignees?.nodes ?? []).map((a: any) => a?.login).filter(Boolean),
        state: n.state === "OPEN" ? "open" : "closed",
        created_at: n.createdAt ?? new Date().toISOString(),
        updated_at: n.updatedAt ?? new Date().toISOString(),
      });
    }
    if (reachedCutoff || !conn?.pageInfo?.hasNextPage || !conn?.pageInfo?.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

export async function fetchPRsForRepoGQL(_octokit: Octokit, full: string, sinceISO?: string): Promise<PartnerPullRequest[]> {
  const [owner, repo] = full.split("/");
  const q = /* GraphQL */ `
    query RepoPRs($owner: String!, $name: String!, $after: String) {
      repository(owner: $owner, name: $name) {
        pullRequests(first: 100, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }, states: [OPEN, MERGED, CLOSED]) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number
            title
            url
            createdAt
            updatedAt
            state
          }
        }
      }
    }
  `;
  const out: PartnerPullRequest[] = [];
  const gql = getGql();
  let after: string | undefined;
  const cutoff = sinceISO ? new Date(sinceISO).getTime() : undefined;

  while (true) {
    const res: any = await withBackoff(() => gql(q, { owner, name: repo, after }));
    const conn = res?.repository?.pullRequests;
    const nodes: any[] = conn?.nodes ?? [];
    let reachedCutoff = false;
    for (const n of nodes) {
      if (cutoff !== undefined && n.updatedAt && new Date(n.updatedAt).getTime() < cutoff) { reachedCutoff = true; break; }
      out.push({
        owner,
        repo,
        number: n.number,
        state: n.state === "OPEN" ? "open" : "closed",
        url: n.url ?? "",
        title: n.title ?? "",
        created_at: n.createdAt ?? new Date().toISOString(),
        updated_at: n.updatedAt ?? new Date().toISOString(),
      });
    }
    if (reachedCutoff || !conn?.pageInfo?.hasNextPage || !conn?.pageInfo?.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}
