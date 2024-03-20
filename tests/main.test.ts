import { server } from "../mocks/node";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, getAllIssues } from "../helpers/github";
import issueDevpoolTemplate from "../mocks/issue-devpool-template.json";
import issueTemplate from "../mocks/issue-template.json";
import { db } from "../mocks/db";
import { drop } from "@mswjs/data";
import opt from "../opt.json";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Devpool Updates", () => {
  async function main() {}

  beforeAll(async () => {
    // @ts-expect-error main() is only exported for testing
    main = await (await import("../index")).main;
  });

  beforeEach(() => {
    drop(db);

    // Add all the default repos of the organization
    for (let i = 0; i < opt.out.length; ++i) {
      const repoName = opt.out[i].split("/")[1];
      db.repo.create({
        id: i + 1,
        owner: DEVPOOL_OWNER_NAME,
        name: repoName,
        html_url: `https://github.com/${DEVPOOL_OWNER_NAME}/${repoName}`,
      });
    }

    db.repo.create({
      id: opt.out.length + 1,
      owner: DEVPOOL_OWNER_NAME,
      name: "test-repo",
      html_url: `https://github.com/${DEVPOOL_OWNER_NAME}/test-repo`,
    });
  });

  test("Update DevPool issues", async () => {
    db.issue.create({
      ...issueDevpoolTemplate,
      id: 1,
      owner: DEVPOOL_OWNER_NAME,
      repo: DEVPOOL_REPO_NAME,
    });
    db.issue.create({
      ...issueTemplate,
      id: 2,
      owner: DEVPOOL_OWNER_NAME,
      repo: "test-repo",
    });
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

  test("Close DevPool issues with no price", async () => {
    db.issue.create({
      ...issueDevpoolTemplate,
      id: 1,
      owner: DEVPOOL_OWNER_NAME,
      repo: DEVPOOL_REPO_NAME,
    });
    db.issue.create({
      ...issueTemplate,
      id: 2,
      owner: DEVPOOL_OWNER_NAME,
      repo: "test-repo",
      labels: [],
    });
    db.issue.create({
      ...issueDevpoolTemplate,
      id: 3,
      state: "closed",
      owner: DEVPOOL_OWNER_NAME,
      repo: DEVPOOL_REPO_NAME,
      labels: [],
    });
    await main();
    const devpoolIssues = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);
    expect(devpoolIssues).toMatchObject([
      {
        ...issueDevpoolTemplate,
        id: 1,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Time: 1h" }, { name: "id: 1" }],
        state: "closed",
      },
      {
        ...issueDevpoolTemplate,
        id: 3,
        labels: [],
        state: "closed",
      },
    ]);
  });
});
