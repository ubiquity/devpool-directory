import { describe, test } from "@jest/globals";
import { drop } from "@mswjs/data";
import { db } from "../mocks/db";
import cfg from "../mocks/issue-devpool-template.json";
import { server } from "../mocks/node";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue } from "../src/directory/directory";
import { getAllIssues } from "../src/directory/get-all-issues";
import { getDirectoryIssueLabelsFromPartnerIssue } from "../src/directory/get-directory-issue-labels";
import { getIssueByLabel } from "../src/directory/get-issue-by-label";
import { getIssueLabelValue } from "../src/directory/get-issue-label-value";
import { getIssuePriceLabel } from "../src/directory/get-issue-price-label";
import { getRepoCredentials } from "../src/directory/get-repo-credentials";
import { getRepoUrls } from "../src/directory/get-repo-urls";
import { getSocialMediaText } from "../src/directory/get-social-media-text";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("GitHub items", () => {
  const githubDevpoolIssueTemplate = cfg as GitHubIssue;

  beforeEach(() => {
    drop(db);
  });

  test("Get owner and repo values", () => {
    const [ownerName, repoName] = getRepoCredentials("https://github.com/owner/repo");
    expect(ownerName).toBe("owner");
    expect(repoName).toBe("repo");
  });

  test("Throw error on missing owner or repo", () => {
    expect(() => getRepoCredentials("https://github.com")).toThrow();
  });

  test("Get social media text", () => {
    const res = getSocialMediaText(githubDevpoolIssueTemplate);
    expect(res).toEqual("200 USD for 1h\n\nhttps://github.com/ubiquity/test-repo/issues/1");
  });

  test("Get issue price label", () => {
    let res = getIssuePriceLabel(githubDevpoolIssueTemplate);
    expect(res).toEqual("Pricing: 200 USD");
    res = getIssuePriceLabel({
      ...githubDevpoolIssueTemplate,
      labels: [],
    });
    expect(res).toEqual("Pricing: not set");
    res = getIssuePriceLabel(githubDevpoolIssueTemplate);
    expect(res).toEqual("Pricing: 200 USD");
  });

  test("Get issue label value", () => {
    let res = getIssueLabelValue(githubDevpoolIssueTemplate, "Pricing");
    expect(res).toEqual("200 USD");
    res = getIssueLabelValue(githubDevpoolIssueTemplate, "Notfound");
    expect(res).toBeNull();
  });

  test("Get issue by label", () => {
    let res = getIssueByLabel([githubDevpoolIssueTemplate], "Pricing: 200 USD");
    expect(res).toMatchObject(githubDevpoolIssueTemplate);
    res = getIssueByLabel([githubDevpoolIssueTemplate], "Notfound");
    expect(res).toBeNull();
  });

  test("Get DevPool labels", () => {
    const res = getDirectoryIssueLabelsFromPartnerIssue(
      {
        ...githubDevpoolIssueTemplate,
        html_url: "https://github.com/owner/repo",
        node_id: "2",
      },
      "https://github.com/owner/repo"
    );
    expect(res).toMatchObject(["Pricing: 200 USD", "Partner: owner/repo", "id: 2", "Time: 1h"]);
  });

  test("Get repo urls", async () => {
    db.repo.create({
      id: 1,
      name: "repo",
      owner: "owner",
      html_url: "https://github.com/owner/repo",
    });
    db.repo.create({
      id: 2,
      name: "test-repo",
      owner: DEVPOOL_OWNER_NAME,
      html_url: "https://github.com/ubiquity/test-repo",
    });
    db.repo.create({
      id: 3,
      name: DEVPOOL_REPO_NAME,
      owner: DEVPOOL_OWNER_NAME,
      html_url: "https://github.com/ubiquity/devpool-directory",
    });
    let res = await getRepoUrls("owner/repo");
    expect(res).toMatchObject(["https://github.com/owner/repo"]);
    res = await getRepoUrls(DEVPOOL_OWNER_NAME);
    expect(res).toMatchObject(["https://github.com/ubiquity/test-repo", "https://github.com/ubiquity/devpool-directory"]);
  });

  test("Get all issues", async () => {
    db.issue.create({ ...githubDevpoolIssueTemplate, repo: DEVPOOL_REPO_NAME, owner: DEVPOOL_OWNER_NAME });
    const issues = await getAllIssues(DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME);
    expect(issues).toMatchObject([githubDevpoolIssueTemplate]);
  });
});
