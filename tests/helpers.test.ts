import { describe, test } from "@jest/globals";
import { server } from "../mocks/node";
import {
  forceCloseMissingIssues,
  getAllIssues,
  getDevpoolIssueLabels,
  getIssueByLabel,
  getIssueLabelValue,
  getIssuePriceLabel,
  getRepoCredentials,
  getRepoUrls,
  getSocialMediaText,
  GitHubIssue,
} from "../helpers/github";
import cfg from "../mocks/issue-devpool-template.json";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("GitHub items", () => {
  const githubIssueTemplate = cfg as GitHubIssue;

  test("Get owner and repo values", () => {
    const [ownerName, repoName] = getRepoCredentials("https://github.com/owner/repo");
    expect(ownerName).toBe("owner");
    expect(repoName).toBe("repo");
  });

  test("Throw error on missing owner or repo", () => {
    expect(() => getRepoCredentials("https://github.com")).toThrow();
  });

  test("Get social media text", () => {
    const res = getSocialMediaText(githubIssueTemplate);
    expect(res).toEqual("200 USD for 1h\n\nbody");
  });

  test("Get issue price label", () => {
    let res = getIssuePriceLabel(githubIssueTemplate);
    expect(res).toEqual("Pricing: 200 USD");
    res = getIssuePriceLabel({
      ...githubIssueTemplate,
      labels: [],
    });
    expect(res).toEqual("Pricing: not set");
    res = getIssuePriceLabel(githubIssueTemplate);
    expect(res).toEqual("Pricing: 200 USD");
  });

  test("Get issue label value", () => {
    let res = getIssueLabelValue(githubIssueTemplate, "Pricing");
    expect(res).toEqual("200 USD");
    res = getIssueLabelValue(githubIssueTemplate, "Notfound");
    expect(res).toBeNull();
  });

  test("Get issue by label", () => {
    let res = getIssueByLabel([githubIssueTemplate], "Pricing: 200 USD");
    expect(res).toMatchObject(githubIssueTemplate);
    res = getIssueByLabel([githubIssueTemplate], "Notfound");
    expect(res).toBeNull();
  });

  test("Get DevPool labels", () => {
    const res = getDevpoolIssueLabels(
      {
        ...githubIssueTemplate,
        html_url: "https://github.com/owner/repo",
        node_id: "1",
      },
      "https://github.com/owner/repo"
    );
    expect(res).toMatchObject(["Pricing: 200 USD", "Partner: owner/repo", "id: 1", "Time: 1h"]);
  });

  test("Get repo urls", async () => {
    let res = await getRepoUrls("owner/repo");
    expect(res).toMatchObject(["https://github.com/owner/repo"]);
    res = await getRepoUrls("org");
    expect(res).toMatchObject(["https://github.com/org/repo1", "https://github.com/org/repo2"]);
  });

  test("Get all issues", async () => {
    const issues = await getAllIssues("owner", "repo");
    expect(issues).toMatchObject(["https://github.com/owner/repo/issues/1"]);
  });

  test("Close missing issues", async () => {
    await forceCloseMissingIssues([githubIssueTemplate], [githubIssueTemplate]);
  });
});
