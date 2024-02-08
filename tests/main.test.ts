import { server } from "../mocks/node";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, getAllIssues } from "../helpers/github";
import issueDevpoolTemplate from "../mocks/issue-devpool-template.json";

beforeAll(() => server.listen());
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
