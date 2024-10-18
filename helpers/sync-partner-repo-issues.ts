import { GitHubIssue } from "./directory/directory";
import { getAllIssues } from "./directory/get-all-issues";
import { getIssueByLabel } from "./directory/get-issue-by-label";
import { getRepoCredentials } from "./directory/get-repo-credentials";
import { newDirectoryIssue } from "./directory/new-directory-issue";
import { syncIssueMetaData as syncDirectoryIssue } from "./directory/sync-issue-meta-data";
import { TwitterMap } from "./initialize-twitter-map";

export async function syncPartnerRepoIssues({
  partnerRepoUrl,
  directoryIssues,
  twitterMap,
}: {
  partnerRepoUrl: string;
  directoryIssues: GitHubIssue[];
  twitterMap: TwitterMap;
}): Promise<GitHubIssue[]> {
  const [ownerName, repoName] = getRepoCredentials(partnerRepoUrl);
  const partnerRepoIssues: GitHubIssue[] = await getAllIssues(ownerName, repoName);
  const buffer: (GitHubIssue | null)[] = [];
  for (const partnerIssue of partnerRepoIssues) {
    // if the issue is open, then add it to the buffer
    if (partnerIssue.state === "open") {
      buffer.push(partnerIssue);
    }

    await createOrSync(partnerIssue);
  }
  return buffer.filter((issue) => issue !== null) as GitHubIssue[];

  async function createOrSync(partnerIssue: GitHubIssue) {
    const directoryIssue: GitHubIssue | null = getIssueByLabel(directoryIssues, `id: ${partnerIssue.node_id}`);

    // adding www creates a link to an issue that does not count as a mention
    // helps with preventing a mention in partner's repo especially during testing

    if (directoryIssue) {
      // if it exists in the Directory, then update it
      await syncDirectoryIssue({
        partnerIssue: partnerIssue,
        directoryIssue: directoryIssue,
      });
    } else {
      // if it doesn't exist in the Directory, then create it
      await newDirectoryIssue(partnerIssue, partnerRepoUrl, twitterMap);
    }

    return directoryIssue;
  }
}
