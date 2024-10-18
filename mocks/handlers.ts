import { http, HttpResponse } from "msw";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue, GitHubLabel } from "../src/directory/directory";
import { db } from "./db";
import issueDevpoolTemplate from "./issue-devpool-template.json";
import { default as issueTemplate, default as totalRewards } from "./issue-template.json";

/**
 * Contains all the handlers for intercepting the listed routes.
 */
export const handlers = [
  http.post("https://api.twitter.com/2/tweets", async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    const obj = db.tweet.create({
      id: db.tweet.count() + 1,
      ...body,
    });
    return HttpResponse.json({
      data: obj,
    });
  }),
  http.get("https://api.github.com/repos/:owner/:repo/contents/:file", () => {
    return HttpResponse.json(totalRewards);
  }),
  http.put("https://api.github.com/repos/:owner/:repo/contents/:file", () => {
    return HttpResponse.json(totalRewards);
  }),
  http.get("https://api.github.com/repos/:owner/:repo", ({ params: { owner, repo } }) => {
    const item = db.repo.findFirst({ where: { name: { equals: repo as string }, owner: { equals: owner as string } } });
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(item);
  }),
  http.get("https://api.github.com/repos/:owner/:repo/issues", ({ params: { owner, repo } }) => {
    return HttpResponse.json(db.issue.findMany({ where: { owner: { equals: owner as string }, repo: { equals: repo as string } } }));
  }),
  http.post("https://api.github.com/repos/:owner/:repo/issues", ({ params: { owner, repo } }) => {
    let newItem: GitHubIssue;
    const id = db.issue.count() + 1;
    if (owner === DEVPOOL_OWNER_NAME && repo === DEVPOOL_REPO_NAME) {
      newItem = { ...issueDevpoolTemplate, id } as GitHubIssue;
    } else {
      newItem = { ...issueTemplate, id } as GitHubIssue;
    }
    db.issue.create(newItem);
    return HttpResponse.json(newItem);
  }),
  http.patch("https://api.github.com/repos/:owner/:repo/issues/:issue", async ({ request, params: { owner, issue, repo } }) => {
    const { labels, ...rest } = (await request.json()) as GitHubIssue;
    const item = db.issue.findFirst({ where: { id: { equals: Number(issue) }, owner: { equals: owner as string }, repo: { equals: repo as string } } });
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    const updatedItem = db.issue.update({
      where: { id: { equals: Number(issue) } },
      data: {
        ...item,
        ...rest,
        labels: labels?.map((label) => ({ name: `${label}` })) || item.labels,
      },
    });
    return HttpResponse.json(updatedItem);
  }),
  http.get("https://api.github.com/orgs/:org/repos", ({ params: { org } }) => {
    return HttpResponse.json(db.repo.findMany({ where: { owner: { equals: org as string } } }));
  }),
  http.post("https://api.github.com/repos/:owner/:repo/issues/:issue/labels", async ({ request, params: { owner, issue, repo } }) => {
    const body = (await request.json()) as { labels: string[] };
    const item = db.issue.findFirst({ where: { id: { equals: Number(issue) }, owner: { equals: owner as string }, repo: { equals: repo as string } } });
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    const updatedItem = db.issue.update({
      where: { id: { equals: Number(issue) } },
      data: {
        ...item,
        labels: body.labels.map((label) => ({ name: `${label}` })),
      },
    });
    return HttpResponse.json(updatedItem);
  }),

  http.delete("https://api.github.com/repos/:owner/:repo/issues/:issue/labels/:label", async ({ params: { owner, issue, repo, label } }) => {
    const item = db.issue.findFirst({ where: { id: { equals: Number(issue) }, owner: { equals: owner as string }, repo: { equals: repo as string } } });
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    const updatedItem = db.issue.update({
      where: { id: { equals: Number(issue) } },
      data: {
        ...item,
        labels: item.labels.filter((l) => (l as GitHubLabel).name !== label),
      },
    });
    return HttpResponse.json(updatedItem);
  }),
  http.get("https://api.github.com/orgs/:org/repos", ({ params: { org } }) => {
    const error = new Error(`Getting ${org} repositories failed`);
    return new HttpResponse(null, { status: 404, statusText: error.message });
  }),
  http.delete("https://api.twitter.com/2/tweets/:id", async ({ params: { id } }) => {
    const item = db.tweet.findFirst({ where: { id: { equals: Number(id) } } });
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    db.tweet.delete({ where: { id: { equals: Number(id) } } });
    return HttpResponse.json(item);
  }),
];
