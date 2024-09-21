import { Octokit } from "@octokit/rest";
import _projects from "../projects.json";

export const DEVPOOL_OWNER_NAME = "ubiquity";
export const DEVPOOL_REPO_NAME = "devpool-directory";

export const octokit = new Octokit({ auth: process.env.DEVPOOL_GITHUB_API_TOKEN });
export const projects = _projects as {
  urls: string[];
  category?: Record<string, string>;
};
