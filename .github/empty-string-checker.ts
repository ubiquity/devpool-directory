import { Octokit } from "@octokit/rest";
import simpleGit from "simple-git";

const token = process.env.GITHUB_TOKEN;
const [owner, repo] = process.env.GITHUB_REPOSITORY?.split("/") || [];
const pullNumber = process.env.GITHUB_PR_NUMBER || process.env.PULL_REQUEST_NUMBER || "0";
const baseRef = process.env.GITHUB_BASE_REF;

if (!token || !owner || !repo || pullNumber === "0" || !baseRef) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

const octokit = new Octokit({ auth: token });
const git = simpleGit();

async function run() {
  try {
    // Get the base and head SHAs for the pull request
    const { data: pullRequest } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: parseInt(pullNumber),
    });

    const baseSha = pullRequest.base.sha;
    const headSha = pullRequest.head.sha;

    // Fetch all remote branches and tags
    await git.fetch(["--all"]);

    // Get the diff of the pull request using the SHAs
    const diff = await git.diff([`origin/${baseRef}...${headSha}`]);

    const violations = parseDiffForEmptyStrings(diff);

    if (violations.length > 0) {
      await createReview(violations);
      process.exit(1); // Exit with error to indicate failure
    } else {
      console.log("No empty strings found.");
    }
  } catch (error) {
    console.error("Error running empty string check:", error);
    process.exit(1);
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
      lineNumber++;
      if (line.includes('""')) {
        violations.push({
          file: currentFile,
          line: lineNumber,
          content: line.substring(1),
        });
      }
    } else if (!line.startsWith("-")) {
      lineNumber++;
    }
  });

  return violations;
}

async function createReview(violations: Array<{ file: string; line: number; content: string }>) {
  const reviewComments = violations.map((v) => ({
    path: v.file,
    line: v.line,
    body: `Warning: Empty string found.\n\`\`\`\n${v.content}\n\`\`\``,
  }));

  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: parseInt(pullNumber),
    event: "COMMENT",
    comments: reviewComments,
    body: "Empty strings detected in the code. Please review.",
  });
}

run().catch((error) => {
  console.error("Error running empty string check:", error);
  process.exit(1);
});
