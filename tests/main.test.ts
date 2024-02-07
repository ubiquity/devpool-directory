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

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("GitHub items", () => {
  const githubIssueTemplate: GitHubIssue = {
    assignee: {
      login: "",
      avatar_url: "",
      email: undefined,
      events_url: "",
      followers_url: "",
      following_url: "",
      gists_url: "",
      gravatar_id: null,
      html_url: "",
      id: 0,
      name: undefined,
      node_id: "",
      organizations_url: "",
      received_events_url: "",
      repos_url: "",
      site_admin: false,
      starred_at: "",
      starred_url: "",
      subscriptions_url: "",
      type: "",
      url: "",
    },
    author_association: "NONE",
    closed_at: null,
    comments: 0,
    comments_url: "",
    created_at: "",
    events_url: "",
    html_url: "",
    id: 0,
    labels_url: "",
    locked: false,
    milestone: null,
    node_id: "",
    number: 0,
    repository_url: "",
    state: "",
    title: "",
    updated_at: "",
    url: "",
    user: null,
    labels: [{ name: "Pricing: 200 USD" }, { name: "Time: 1h" }],
    body: "body",
  };

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
    expect(issues).toMatchObject(["https://github.com/owner/repo"]);
  });

  test("Get all issues", async () => {
    const issues = await getAllIssues("owner", "repo");
    expect(issues).toMatchObject(["https://github.com/owner/repo"]);
  });

  test("Get all issues", async () => {
    const issues = await getAllIssues("owner", "repo");
    expect(issues).toMatchObject(["https://github.com/owner/repo"]);
  });

  test("Close missing issues", async () => {
    await forceCloseMissingIssues([githubIssueTemplate], [githubIssueTemplate]);
  });
});
