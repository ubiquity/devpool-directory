import { http, HttpResponse } from "msw";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue } from "../helpers/github";
import issueDevpoolTemplate from "./issue-devpool-template.json";
import issueTemplate from "./issue-template.json";

const issueDb: { [s in string]: { [p in string]: Array<GitHubIssue> } } = {
  [DEVPOOL_OWNER_NAME]: {
    "test-repo": [issueTemplate as GitHubIssue],
    [DEVPOOL_REPO_NAME]: [issueDevpoolTemplate as GitHubIssue],
  },
};

/**
 * Contains all the handlers for intercepting the listed routes.
 */
export const handlers = [
  http.post("https://api.twitter.com/2/tweets", () => {
    return HttpResponse.json({
      data: {
        id: 1,
        text: "text",
      },
    });
  }),
  http.get("https://api.github.com/repos/:owner/:repo", ({ params: { owner, repo } }) => {
    return HttpResponse.json({
      html_url: `https://github.com/${owner}/${repo}`,
    });
  }),
  http.get("https://api.github.com/repos/:owner/:repo/issues", ({ params: { owner, repo } }) => {
    return HttpResponse.json(issueDb[owner as string][repo as string]);
  }),
  http.post("https://api.github.com/repos/:owner/:repo/issues", ({ params: { owner, repo } }) => {
    let newItem: GitHubIssue;
    const id = issueDb[owner as string][repo as string].length + 1;
    if (owner === DEVPOOL_OWNER_NAME && repo === DEVPOOL_REPO_NAME) {
      newItem = { ...issueDevpoolTemplate, id } as GitHubIssue;
    } else {
      newItem = { ...issueTemplate, id } as GitHubIssue;
    }
    issueDb[owner as string][repo as string].push(newItem);
    return HttpResponse.json(newItem);
  }),
  http.patch("https://api.github.com/repos/:owner/:repo/issues/:issue", ({ params: { owner, repo } }) => {
    return HttpResponse.json(issueDb[owner as string][repo as string]);
  }),
  http.get("https://api.github.com/orgs/:org/repos", ({ params: { org } }) => {
    return HttpResponse.json(
      Object.keys(issueDb[org as string]).map((key) => ({
        html_url: `https://github.com/${org}/${key}`,
      }))
    );
  }),
];
