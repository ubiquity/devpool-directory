import { server } from "../mocks/node";
import { describe, test } from "@jest/globals";
import dotenv from "dotenv";
import { http, HttpResponse } from "msw";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Twitter", () => {
  test("Throw on missing all env variables", async () => {
    // Save the current environment variables
    const originalEnv = process.env;

    process.env = {
      ...originalEnv,
      TWITTER_API_KEY: undefined,
      TWITTER_API_KEY_SECRET: undefined,
      TWITTER_ACCESS_TOKEN: undefined,
      TWITTER_ACCESS_TOKEN_SECRET: undefined,
    };

    // Use jest.resetModules to ensure the module is reloaded with new env vars
    jest.resetModules();

    await expect(async () => {
      const { default: twitterHelper } = await import("../helpers/twitter");
      console.log(twitterHelper);
    }).rejects.toThrow("Twitter environment variables are not set");

    process.env = originalEnv;
  });

  test("Throw on missing TOKEN_SECRET", async () => {
    // Save the current environment variables
    const originalEnv = process.env;

    process.env = {
      ...originalEnv,
      TWITTER_ACCESS_TOKEN_SECRET: undefined,
    };

    // Use jest.resetModules to ensure the module is reloaded with new env vars
    jest.resetModules();

    await expect(async () => {
      const { default: twitterHelper } = await import("../helpers/twitter");
      console.log(twitterHelper);
    }).rejects.toThrow("Twitter environment variables are not set");

    process.env = originalEnv;
  });

  test("Throw on missing ACCESS_TOKEN", async () => {
    // Save the current environment variables
    const originalEnv = process.env;

    process.env = {
      ...originalEnv,
      TWITTER_ACCESS_TOKEN: undefined,
    };

    // Use jest.resetModules to ensure the module is reloaded with new env vars
    jest.resetModules();

    await expect(async () => {
      const { default: twitterHelper } = await import("../helpers/twitter");
      console.log(twitterHelper);
    }).rejects.toThrow("Twitter environment variables are not set");

    process.env = originalEnv;
  });

  test("Throw on missing API_KEY_SECRET", async () => {
    // Save the current environment variables
    const originalEnv = process.env;

    process.env = {
      ...originalEnv,
      TWITTER_API_KEY_SECRET: undefined,
    };

    // Use jest.resetModules to ensure the module is reloaded with new env vars
    jest.resetModules();

    await expect(async () => {
      const { default: twitterHelper } = await import("../helpers/twitter");
      console.log(twitterHelper);
    }).rejects.toThrow("Twitter environment variables are not set");

    process.env = originalEnv;
  });

  test("Throw on missing API_KEY", async () => {
    // Save the current environment variables
    const originalEnv = process.env;

    process.env = {
      ...originalEnv,
      TWITTER_API_KEY: undefined,
    };

    // Use jest.resetModules to ensure the module is reloaded with new env vars
    jest.resetModules();

    await expect(async () => {
      const { default: twitterHelper } = await import("../helpers/twitter");
      console.log(twitterHelper);
    }).rejects.toThrow("Twitter environment variables are not set");

    process.env = originalEnv;
  });

  test("Post Tweet successfully", async () => {
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

  test("Expect Tweet post failure on network error", async () => {
    // silence stderr since we expect errors to be logged
    jest.spyOn(console, "error").mockImplementation(jest.fn());
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
