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
      pull_number: parseInt(pullNumber, 10),
    });

    const baseSha = pullRequest.base.sha;
    const headSha = pullRequest.head.sha;

    await git.fetch(["origin", baseSha, headSha]);

    const diff = await git.diff([`${baseSha}...${headSha}`]);

    core.info("Checking for empty strings...");
    const violations = parseDiffForEmptyStrings(diff);

    if (violations.length > 0) {
      violations.forEach(({ file, line, content }) => {
        core.warning(
          "Detected an empty string.\n\nIf this is during variable initialization, consider using a different approach.\nFor more information, visit: https://www.github.com/ubiquity/ts-template/issues/31",
          {
            file,
            startLine: line,
          }
        );
      });

      // core.setFailed(`${violations.length} empty string${violations.length > 1 ? "s" : ""} detected in the code.`);

      await octokit.rest.checks.create({
        owner,
        repo,
        name: "Empty String Check",
        head_sha: headSha,
        status: "completed",
        conclusion: violations.length > 0 ? "failure" : "success",
        output: {
          title: "Empty String Check Results",
          summary: `Found ${violations.length} violation${violations.length !== 1 ? "s" : ""}`,
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

  let currentFile: string;
  let headLine = 0;
  let inHunk = false;

  diffLines.forEach((line) => {
    const hunkHeaderMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkHeaderMatch) {
      headLine = parseInt(hunkHeaderMatch[1], 10);
      inHunk = true;
      return;
    }

    if (line.startsWith("--- a/") || line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      inHunk = false;
      return;
    }

    // Only process TypeScript files
    if (!currentFile?.endsWith(".ts")) {
      return;
    }

    if (inHunk && line.startsWith("+")) {
      // Check for empty strings in TypeScript syntax
      if (/^\+.*""/.test(line)) {
        // Ignore empty strings in comments
        if (!line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          // Ignore empty strings in template literals
          if (!/`[^`]*\$\{[^}]*\}[^`]*`/.test(line)) {
            violations.push({
              file: currentFile,
              line: headLine,
              content: line.substring(1).trim(),
            });
          }
        }
      }
      headLine++;
    } else if (!line.startsWith("-")) {
      headLine++;
    }
  });

  return violations;
}
main().catch((error) => {
  core.setFailed(`Error running empty string check: ${error instanceof Error ? error.message : String(error)}`);
});
