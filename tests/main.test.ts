import { server } from "../mocks/node";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, getAllIssues, GitHubIssue } from "../helpers/github";
import issueDevpoolTemplate from "../mocks/issue-devpool-template.json";
import { issueDb } from "../mocks/handlers";
import issueTemplate from "../mocks/issue-template.json";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Devpool Updates", () => {
  let main = async () => {};

  beforeAll(async () => {
    // @ts-expect-error main() is only exported for testing
    main = await (await import("../index")).main;
  });

  test("Update DevPool issues", async () => {
    await main();
    const devpoolIssues = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);
    expect(devpoolIssues).toMatchObject([
      {
        ...issueDevpoolTemplate,
        id: 1,
        body: "https://github.com/ubiquity/test-repo/issues/1",
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 1" }, { name: "Time: 1h" }],
      },
    ]);
  });

  test("Close DevPool issues", async () => {
    issueDb[DEVPOOL_OWNER_NAME]["repo2"] = [{ ...(issueTemplate as GitHubIssue), id: 1, html_url: `https://github.com/${DEVPOOL_OWNER_NAME}/repo2/issues/1` }];
    await main();
    const devpoolIssues = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);
    expect(devpoolIssues).toMatchObject([
      {
        ...issueDevpoolTemplate,
        id: 1,
        body: "https://github.com/ubiquity/repo2/issues/1",
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/repo2" }, { name: "id: 1" }, { name: "Time: 1h" }],
      },
    ]);
  });
});
