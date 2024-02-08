import { http, HttpResponse } from "msw";

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
  http.get("https://api.github.com/orgs/:org/repos", ({ params: { org } }) => {
    return HttpResponse.json([
      {
        html_url: `https://github.com/${org}/repo1`,
      },
      {
        html_url: `https://github.com/${org}/repo2`,
      },
    ]);
  }),
  http.get("https://api.github.com/repos/:owner/:repo", ({ params: { owner, repo } }) => {
    return HttpResponse.json({
      html_url: `https://github.com/${owner}/${repo}`,
    });
  }),
  // http.get("https://api.github.com/repos/ubiquity/devpool-directory/issues?state=all", ({ params: { owner, repo } }) => {
  //   return HttpResponse.json({
  //     html_url: `https://github.com/${owner}/${repo}`,
  //   });
  // }),
  http.get("https://api.github.com/repos/:owner/:repo/issues", ({ params: { owner, repo } }) => {
    return HttpResponse.json([`https://github.com/${owner}/${repo}/issues/1`]);
  }),
];
