import { server } from "../mocks/node";
import { describe, test } from "@jest/globals";
import twitter from "../helpers/twitter";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Twitter", () => {
  test("Post a Tweet", async () => {
    const res = await twitter.postTweet("status");
    expect(res).not.toBeUndefined();
  });
});
