import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import _projects from "../../projects.json";
dotenv.config();

export const octokit = new Octokit({ auth: process.env.DEVPOOL_GITHUB_API_TOKEN });

export const PRICING_NOT_SET = "Pricing: not set";

export const DEVPOOL_OWNER_NAME = process.env.DEVPOOL_OWNER_NAME as string;
export const DEVPOOL_REPO_NAME = process.env.DEVPOOL_REPO_NAME as string;

if (!DEVPOOL_OWNER_NAME || !DEVPOOL_REPO_NAME) {
  throw new Error("DEVPOOL_OWNER_NAME or DEVPOOL_REPO_NAME not set");
}
if (typeof DEVPOOL_OWNER_NAME !== "string" || typeof DEVPOOL_REPO_NAME !== "string") {
  throw new Error("DEVPOOL_OWNER_NAME or DEVPOOL_REPO_NAME is not a string");
}

export type GitHubIssue = RestEndpointMethodTypes["issues"]["get"]["response"]["data"];
export type GitHubLabel = RestEndpointMethodTypes["issues"]["listLabelsOnIssue"]["response"]["data"][0];

export type StateChanges<T extends string = "open" | "closed"> = {
  [key: string]: {
    cause: boolean;
    effect: T;
    comment: string;
  };
};

export const projects = _projects as {
  urls: string[];
  category?: Record<string, string>;
};

export enum Labels {
  PRICE = "Price",
  UNAVAILABLE = "Unavailable",
}
