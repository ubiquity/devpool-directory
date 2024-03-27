/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupServer } from "msw/node";
import { GitHubIssue } from "../helpers/github";
import { db } from "../mocks/db";
import { handlers } from "../mocks/handlers";
import { drop } from "@mswjs/data";
import issueDevpoolTemplate from "../mocks/issue-devpool-template.json";
import issueTemplate from "../mocks/issue-template.json";
import { handleDevPoolIssue } from "../mocks/mock-issue-handlers";

const DEVPOOL_OWNER_NAME = "ubiquity";
const DEVPOOL_REPO_NAME = "devpool-directory";
const UBIQUITY_TEST_REPO = "https://github.com/ubiquity/test-repo";

const server = setupServer(...handlers);

beforeAll(() => server.listen());
afterEach(() => {
  const openIssues = db.issue.findMany({
    where: {
      state: {
        equals: "open",
      },
    },
  });

  openIssues.forEach((issue) => {
    const unavailableLabel = issue.labels.find((label: string | unknown) => {
      if (label && typeof label === "object" && "name" in label) {
        return label.name === "Unavailable";
      } else if (typeof label === "string") {
        return label.includes("Unavailable");
      } else {
        return false;
      }
    });
    expect(unavailableLabel).toBeUndefined();
  });

  server.resetHandlers();
  drop(db);
});
afterAll(() => server.close());

function createIssues(devpoolIssue: GitHubIssue, projectIssue: GitHubIssue) {
  db.issue.create(devpoolIssue);
  db.issue.create(projectIssue);

  return db.issue.findFirst({
    where: {
      id: {
        equals: devpoolIssue.id,
      },
    },
  }) as GitHubIssue;
}

describe("handleDevPoolIssue", () => {
  const logSpy = jest.spyOn(console, "log").mockImplementation();

  beforeEach(() => {
    logSpy.mockClear();
  });

  describe("Devpool Directory", () => {
    beforeEach(() => {
      db.repo.create({
        id: 1,
        html_url: "https://github.com/ubiquity/devpool-directory",
        name: DEVPOOL_REPO_NAME,
        owner: DEVPOOL_OWNER_NAME,
      });
      db.repo.create({
        id: 2,
        owner: DEVPOOL_OWNER_NAME,
        name: "test-repo",
        html_url: `https://github.com/${DEVPOOL_OWNER_NAME}/test-repo`,
      });
    });
    test("updates issue title in devpool when project issue title changes", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        title: "Original Title",
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        title: "Updated Title",
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.title).toEqual("Updated Title");

      expect(logSpy).toHaveBeenCalledWith(`Updated metadata: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Title: ${devpoolIssue.title} -> ${partnerIssue.title}`);
    });

    test("updates issue labels in devpool when project issue labels change", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 2" }, { name: "Time: 1h" }],
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        labels: issueTemplate.labels?.concat({ name: "enhancement" }),
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.labels).toEqual(expect.arrayContaining([{ name: "enhancement" }]));

      expect(logSpy).toHaveBeenCalledWith(`Updated metadata: ${updatedIssue.html_url} (${partnerIssue.html_url})`);

      expect(logSpy).toHaveBeenCalledWith(
        `Labels: ${devpoolIssue.labels
          .map((label) => (label as any).name)
          .sort()
          .join(",")} -> ${updatedIssue.labels.map((label) => (label as any).name).join(",")}`
      );
    });

    test("does not update issue when no metadata changes are detected", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 2" }, { name: "Time: 1h" }],
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      expect(logSpy).not.toHaveBeenCalled();
    });

    test("keeps devpool issue state unchanged when project issue state matches devpool issue state", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 2" }, { name: "Time: 1h" }],
        state: "open",
      } as GitHubIssue;
      const partnerIssue = {
        ...issueTemplate,
        state: "open",
      } as GitHubIssue;

      createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, devpoolIssue, false);

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Updated state"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Reopened"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Closed"));
    });

    test("keeps devpool issue state unchanged when project issue state is closed and devpool issue state is closed", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 2" }, { name: "Time: 1h" }],
        state: "closed",
      } as GitHubIssue;
      const partnerIssue = {
        ...issueTemplate,
        state: "closed",
      } as GitHubIssue;

      createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, devpoolIssue, false);

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Updated state"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Reopened"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Closed"));
    });

    test("keeps devpool issue state unchanged when project issue state is closed, assigned and devpool issue state is closed", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 2" }, { name: "Time: 1h" }],
        state: "closed",
      } as GitHubIssue;
      const partnerIssue = {
        ...issueTemplate,
        state: "closed",
        assignee: {
          login: "hunter",
        } as GitHubIssue["assignee"],
      } as GitHubIssue;

      createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, devpoolIssue, false);

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Updated state"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Reopened"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Closed"));
    });

    test("keeps devpool issue state unchanged when project issue state is closed, merged, unassigned and devpool issue state is closed", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 2" }, { name: "Time: 1h" }],
        state: "closed",
      } as GitHubIssue;
      const partnerIssue = {
        ...issueTemplate,
        state: "closed",
        pull_request: {
          merged_at: new Date().toISOString(),
          diff_url: "https//github.com/ubiquity/test-repo/pull/1.diff",
          html_url: "https//github.com/ubiquity/test-repo/pull/1",
          patch_url: "https//github.com/ubiquity/test-repo/pull/1.patch",
          url: "https//github.com/ubiquity/test-repo/pull/1",
        },
      } as GitHubIssue;

      createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, devpoolIssue, false);

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Updated state"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Reopened"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Closed"));
    });

    test("keeps devpool state unchanged when project issue state is open, assigned, merged and devpool issue state is closed", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 2" }, { name: "Time: 1h" }],
        state: "closed",
      } as GitHubIssue;
      const partnerIssue = {
        ...issueTemplate,
        state: "open",
        assignee: {
          login: "hunter",
        } as GitHubIssue["assignee"],
        pull_request: {
          merged_at: new Date().toISOString(),
          diff_url: "https//github.com/ubiquity/test-repo/pull/1.diff",
          html_url: "https//github.com/ubiquity/test-repo/pull/1",
          patch_url: "https//github.com/ubiquity/test-repo/pull/1.patch",
          url: "https//github.com/ubiquity/test-repo/pull/1",
        },
      } as GitHubIssue;

      createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, devpoolIssue, false);

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Updated"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Reopened"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Closed"));
    });

    test("keeps devpool state unchanged when project issue state is open, unassigned and devpool issue state is open", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 2" }, { name: "Time: 1h" }],
        state: "open",
      } as GitHubIssue;
      const partnerIssue = {
        ...issueTemplate,
        state: "open",
      } as GitHubIssue;

      createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, devpoolIssue, false);

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Updated state"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Reopened"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Closed"));
    });

    test("keeps devpool state unchanged when project issue state is open, unassigned, merged and devpool issue state is open", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        labels: [{ name: "Pricing: 200 USD" }, { name: "Partner: ubiquity/test-repo" }, { name: "id: 2" }, { name: "Time: 1h" }],
        state: "open",
      } as GitHubIssue;
      const partnerIssue = {
        ...issueTemplate,
        state: "open",
        pull_request: {
          merged_at: new Date().toISOString(),
          diff_url: "https//github.com/ubiquity/test-repo/pull/1.diff",
          html_url: "https//github.com/ubiquity/test-repo/pull/1",
          patch_url: "https//github.com/ubiquity/test-repo/pull/1.patch",
          url: "https//github.com/ubiquity/test-repo/pull/1",
        },
      } as GitHubIssue;

      createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, devpoolIssue, false);

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Updated state"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Reopened"));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Closed"));
    });

    // cause: !projectIssues.some((projectIssue) => projectIssue.node_id == getIssueLabelValue(devpoolIssue, "id:"))
    // comment: "Closed (missing in partners):"
    test("closes devpool issue when project issue is missing", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        node_id: "1234",
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (missing in partners):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    // cause: hasNoPriceLabels && devpoolIssue.state == "open"
    // comment: "Closed (no price labels):"
    test("closes devpool issue when project issue has no price labels", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        labels: [],
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (no price labels):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    // cause: projectIssue.state == "closed" && devpoolIssue.state == "open" && !!projectIssue.pull_request?.merged_at,
    // comment: "Closed (merged):"
    test("closes devpool issue when project issue is merged", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        state: "closed",
        pull_request: {
          merged_at: new Date().toISOString(),
          diff_url: "https//github.com/ubiquity/test-repo/pull/1.diff",
          html_url: "https//github.com/ubiquity/test-repo/pull/1",
          patch_url: "https//github.com/ubiquity/test-repo/pull/1.patch",
          url: "https//github.com/ubiquity/test-repo/pull/1",
        },
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (merged):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    // cause: projectIssue.state == "closed" && devpoolIssue.state == "open"
    // comment: "Closed (not merged):"
    test("closes devpool issue when project issue is closed", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        state: "open",
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        state: "closed",
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (not merged):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    // cause: projectIssue.state == "closed" && devpoolIssue.state == "open" && !!projectIssue.assignee?.login,
    // comment: "Closed (assigned-closed):",
    test("closes devpool issue when project issue is closed and assigned", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        state: "closed",
        assignee: {
          login: "hunter",
        } as GitHubIssue["assignee"],
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (assigned-closed):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    // cause: projectIssue.state == "open" && devpoolIssue.state == "open" && !!projectIssue.assignee?.login,
    // comment: "Closed (assigned-open):"
    test("closes devpool issue when project issue is open and assigned", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        assignee: {
          login: "hunter",
        } as GitHubIssue["assignee"],
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (assigned-open):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    // cause: projectIssue.state == "open" && devpoolIssue.state == "closed" && !projectIssue.assignee?.login && !hasNoPriceLabels
    // comment: "Reopened (unassigned):",
    test("reopens devpool issue when project issue is reopened", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        state: "closed",
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        state: "open",
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("open");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Reopened (unassigned):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    // cause: projectIssue.state == "open" && devpoolIssue.state == "closed" && !!projectIssue.pull_request?.merged_at && !hasNoPriceLabels,
    // comment: "Reopened (merged):",
    test("reopens devpool issue when project issue is unassigned, reopened and merged", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        state: "closed",
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        state: "open",
        pull_request: {
          merged_at: new Date().toISOString(),
          diff_url: "https//github.com/ubiquity/test-repo/pull/1.diff",
          html_url: "https//github.com/ubiquity/test-repo/pull/1",
          patch_url: "https//github.com/ubiquity/test-repo/pull/1.patch",
          url: "https//github.com/ubiquity/test-repo/pull/1",
        },
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, UBIQUITY_TEST_REPO, issueInDb, false);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Reopened (merged):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });
  });

  const HTML_URL = "https://github.com/not-ubiquity/devpool-directory/issues/1";
  const REPO_URL = "https://github.com/not-ubiquity/devpool-directory";
  const PROJECT_URL = "https://github.com/ubiquity/test-repo";
  const BODY = "https://www.github.com/ubiquity/test-repo/issues/1";
  /**
   * ========================
   * DEVPOOL FORKED REPO
   * ========================
   */

  describe("Forked Devpool", () => {
    // need to mock DEVPOOL_OWNER_NAME
    jest.mock("../helpers/github", () => ({
      ...jest.requireActual("../helpers/github"),
      DEVPOOL_OWNER_NAME: "not-ubiquity",
    }));

    beforeEach(() => {
      db.repo.create({
        id: 1,
        owner: "not-ubiquity",
        name: DEVPOOL_REPO_NAME,
        html_url: REPO_URL,
      });
      db.repo.create({
        id: 2,
        owner: DEVPOOL_OWNER_NAME,
        name: "test-repo",
        html_url: `https://github.com/${DEVPOOL_OWNER_NAME}/test-repo`,
      });
      db.repo.create({
        id: 3,
        owner: DEVPOOL_OWNER_NAME,
        name: DEVPOOL_REPO_NAME,
        html_url: `https://github.com/${DEVPOOL_OWNER_NAME}/${DEVPOOL_REPO_NAME}`,
      });
    });

    afterAll(() => {
      jest.unmock("../helpers/github");
    });

    test("updates issue title in devpool when project issue title changes in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        title: "Original Title",
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        title: "Updated Title",
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.title).toEqual("Updated Title");

      expect(logSpy).toHaveBeenCalledWith(`Updated metadata: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Title: ${devpoolIssue.title} -> ${partnerIssue.title}`);
    });

    test("updates issue labels in devpool when project issue labels change in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        labels: issueTemplate.labels?.concat({ name: "enhancement" }),
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();

      expect(logSpy).toHaveBeenCalledWith(`Updated metadata: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(
        `Labels: ${devpoolIssue.labels.map((label) => (label as any).name).join(",")} -> ${updatedIssue.labels.map((label) => (label as any).name).join(",")}`
      );
    });

    test("closes devpool issue when project issue is missing in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        node_id: "1234",
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (missing in partners):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    test("closes devpool issue when project issue has no price labels in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        labels: [],
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (no price labels):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    test("closes devpool issue when project issue is merged in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        state: "closed",
        pull_request: {
          merged_at: new Date().toISOString(),
          diff_url: "https//github.com/ubiquity/test-repo/pull/1.diff",
          html_url: "https//github.com/ubiquity/test-repo/pull/1",
          patch_url: "https//github.com/ubiquity/test-repo/pull/1.patch",
          url: "https//github.com/ubiquity/test-repo/pull/1",
        },
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (merged):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    test("closes devpool issue when project issue is closed in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        state: "closed",
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (not merged):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    test("closes devpool issue when project issue is closed and assigned in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        state: "closed",
        assignee: {
          login: "hunter",
        } as GitHubIssue["assignee"],
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (assigned-closed):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    test("closes devpool issue when project issue is open and assigned in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        assignee: {
          login: "hunter",
        } as GitHubIssue["assignee"],
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).toHaveBeenCalledWith(`Updated state: ${updatedIssue.html_url} (${partnerIssue.html_url})`);
      expect(logSpy).toHaveBeenCalledWith(`Closed (assigned-open):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    test("reopens devpool issue when project issue is reopened and unassigned in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        id: 1,
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
        state: "closed",
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        state: "open",
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("open");

      expect(logSpy).toHaveBeenCalledWith(`Reopened (unassigned):: ${partnerIssue.node_id}-${partnerIssue.number}`);
    });

    test("should not reopen devpool issue when project issue is reopened, assigned and merged in forked repo", async () => {
      const devpoolIssue = {
        ...issueDevpoolTemplate,
        html_url: HTML_URL,
        repository_url: REPO_URL,
        body: BODY,
        state: "closed",
      } as GitHubIssue;

      const partnerIssue = {
        ...issueTemplate,
        id: 2,
        state: "open",
        assignee: {
          login: "hunter",
        } as GitHubIssue["assignee"],
        pull_request: {
          merged_at: new Date().toISOString(),
          diff_url: "https//github.com/ubiquity/test-repo/pull/1.diff",
          html_url: "https//github.com/ubiquity/test-repo/pull/1",
          patch_url: "https//github.com/ubiquity/test-repo/pull/1.patch",
          url: "https//github.com/ubiquity/test-repo/pull/1",
        },
      } as GitHubIssue;

      const issueInDb = createIssues(devpoolIssue, partnerIssue);

      await handleDevPoolIssue([partnerIssue], partnerIssue, PROJECT_URL, issueInDb, true);

      const updatedIssue = db.issue.findFirst({
        where: {
          id: {
            equals: 1,
          },
        },
      }) as GitHubIssue;

      expect(updatedIssue).not.toBeNull();
      expect(updatedIssue?.state).toEqual("closed");

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining(`Updated state`));
    });
  });
});
