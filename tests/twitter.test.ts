import { server } from "../mocks/node";
import { describe, test } from "@jest/globals";
import dotenv from "dotenv";
import { http, HttpResponse } from "msw";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Twitter", () => {
  test("Throw on missing env", async () => {
    // Save the env first to test throws with missing env values
    const savedEnv = process.env;
    await expect(async () => {
      dotenv.config({
        override: true,
      });
      process.env.TWITTER_API_KEY = "";
      await import("../helpers/twitter");
    }).rejects.toThrow();
    await expect(async () => {
      dotenv.config({
        override: true,
      });
      process.env.TWITTER_API_KEY_SECRET = "";
      await import("../helpers/twitter");
    }).rejects.toThrow();
    await expect(async () => {
      dotenv.config({
        override: true,
      });
      process.env.TWITTER_ACCESS_TOKEN = "";
      await import("../helpers/twitter");
    }).rejects.toThrow();
    await expect(async () => {
      dotenv.config({
        override: true,
      });
      process.env.TWITTER_ACCESS_TOKEN_SECRET = "";
      await import("../helpers/twitter");
    }).rejects.toThrow();
    dotenv.config({
      override: true,
    });
    process.env = savedEnv;
  });

  test("Post Tweet", async () => {
    dotenv.config({
      override: true,
    });
    process.env.TWITTER_API_KEY = "foobar";
    process.env.TWITTER_API_KEY_SECRET = "foobar";
    process.env.TWITTER_ACCESS_TOKEN = "foobar";
    process.env.TWITTER_ACCESS_TOKEN_SECRET = "foobar";
    const twitter = (await import("../helpers/twitter")).default;
    const res = await twitter.postTweet("status");
    expect(res).not.toBeUndefined();
  });

  test("Fail to post Tweet", async () => {
    dotenv.config({
      override: true,
    });
    process.env.TWITTER_API_KEY = "foobar";
    process.env.TWITTER_API_KEY_SECRET = "foobar";
    process.env.TWITTER_ACCESS_TOKEN = "foobar";
    process.env.TWITTER_ACCESS_TOKEN_SECRET = "foobar";
    server.use(
      http.post("https://api.twitter.com/2/tweets", () => {
        return HttpResponse.error();
      })
    );
    const t = (await import("../helpers/twitter")).default;
    const empty = await t.postTweet("status");
    expect(empty).toBeUndefined();
  });
});
