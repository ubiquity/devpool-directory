import { server } from "../mocks/node";
import { http, HttpResponse } from "msw";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, getAllIssues, GitHubIssue } from "../helpers/github";
import issueTemplate from "../mocks/issue-template.json";
import issueDevpoolTemplate from "../mocks/issue-devpool-template.json";

const issueDb: { [s in string]: { [p in string]: Array<GitHubIssue> } } = {
  [DEVPOOL_OWNER_NAME]: {
    "test-repo": [issueTemplate as GitHubIssue],
    [DEVPOOL_REPO_NAME]: [issueDevpoolTemplate as GitHubIssue],
  },
};

beforeAll(() => {
  server.use(
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
    })
  );
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Devpool Updates", () => {
  test("Update DevPool issues", async () => {
    // @ts-expect-error main() is only exported for testing
    await (await import("../index")).main();
    const devpoolIssues = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);
    expect(devpoolIssues).toMatchObject([{ ...issueDevpoolTemplate, id: 1 }]);
  });
});
