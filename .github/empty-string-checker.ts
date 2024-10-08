import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import simpleGit from "simple-git";

const token = process.env.GITHUB_TOKEN;
const [owner, repo] = process.env.GITHUB_REPOSITORY?.split("/") || [];
const pullNumber = process.env.GITHUB_PR_NUMBER || process.env.PULL_REQUEST_NUMBER || "0";
const baseRef = process.env.GITHUB_BASE_REF;

if (!token || !owner || !repo || pullNumber === "0" || !baseRef) {
  core.setFailed("Missing required environment variables.");
  process.exit(1);
}

const octokit = new Octokit({ auth: token });
const git = simpleGit();

async function main() {
  try {
    const { data: pullRequest } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: parseInt(pullNumber),
    });

    const baseSha = pullRequest.base.sha;
    const headSha = pullRequest.head.sha;

    await git.fetch(["origin", baseSha, headSha]);

    const diff = await git.diff([`${baseSha}...${headSha}`]);

    core.info("Checking for empty strings...");
    const violations = parseDiffForEmptyStrings(diff);

    if (violations.length > 0) {
      violations.forEach(({ file, line, content }) => {
        core.warning(`Empty string found: ${content}`, {
          file,
          startLine: parseInt(line.toString()),
        });
      });
      // core.setFailed(`${emptyStrings.length} empty string${emptyStrings.length > 1 ? "s" : ""} detected in the code.`);

      await octokit.rest.checks.create({
        owner,
        repo,
        name: "Empty String Check",
        head_sha: headSha,
        status: "completed",
        conclusion: violations.length > 0 ? "failure" : "success",
        output: {
          title: "Empty String Check Results",
          summary: `Found ${violations.length} violations`,
          annotations: violations.map((v) => ({
            path: v.file,
            start_line: v.line,
            end_line: v.line,
            annotation_level: "warning",
            message: "Empty string found",
            raw_details: v.content,
          })),
        },
      });
    } else {
      core.info("No empty strings found.");
    }
  } catch (error) {
    core.setFailed(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseDiffForEmptyStrings(diff: string) {
  const violations: Array<{ file: string; line: number; content: string }> = [];
  const diffLines = diff.split("\n");

  let currentFile = "";
  let lineNumber = 0;

  diffLines.forEach((line) => {
    if (line.startsWith("+++ b/")) {
      currentFile = line.replace("+++ b/", "");
      lineNumber = 0;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      if (line.includes('""')) {
        violations.push({
          file: currentFile,
          line: lineNumber++,
          content: line.substring(1),
        });
      }
    } else if (!line.startsWith("-")) {
      lineNumber++;
    }
  });

  return violations;
}

main().catch((error) => {
  core.setFailed(`Error running empty string check: ${error instanceof Error ? error.message : String(error)}`);
});
