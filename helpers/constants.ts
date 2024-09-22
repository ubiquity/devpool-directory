import { Octokit } from "@octokit/rest";
import _projects from "../projects.json";

/**
 * Used for capturing the relevant task from the devpool body
 *
 * Uses Groups to return an object with the following properties:
 * - owner
 * - repo
 * - number
 */
export const DEVPOOL_TASK_BODY_REGEX = /https:\/\/(www\.)?github.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/issues\/(?<number>\d+)/;
export const DEVPOOL_OWNER_NAME = "ubiquity";
export const DEVPOOL_REPO_NAME = "devpool-directory";

export const octokit = new Octokit({ auth: process.env.DEVPOOL_GITHUB_API_TOKEN });
export const projects = _projects as {
  urls: string[];
  category?: Record<string, string>;
};
