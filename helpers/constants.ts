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

// @DEV - actions feed it automatically from the forked repo but for local testing,
// you need to set it manually to `ubiquity/devpool-directory` so that tests can run
const devpoolOwnerRepo = process.env.OWNER_REPO;
if (!devpoolOwnerRepo) {
  throw new Error("OWNER_REPO is not set in the environment variables");
}
const [owner, repo] = devpoolOwnerRepo.split("/");

/**
 * Owner of the devpool repository, forked instance workflows will
 * receive this automatically from the workflow environment.
 *
 * For local testing, you need to set it manually to `ubiquity`
 * so that tests can run successfully.
 */
export const DEVPOOL_OWNER_NAME = owner;
export const DEVPOOL_REPO_NAME = repo;

export const octokit = new Octokit({ auth: process.env.DEVPOOL_GITHUB_API_TOKEN });
export const projects = _projects as {
  urls: string[];
  category?: Record<string, string>;
};
