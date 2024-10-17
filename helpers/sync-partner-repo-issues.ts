import { checkIfForked } from "./directory/check-if-forked";
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
  const fullIssuesPerPartnerRepo: GitHubIssue[] = await getAllIssues(ownerName, repoName);
  const buffer: (GitHubIssue | null)[] = [];
  for (const fullIssuePerPartnerRepo of fullIssuesPerPartnerRepo) {
    // if the issue is available and unassigned, then add it to the buffer
    if (fullIssuePerPartnerRepo.state === "open" && fullIssuePerPartnerRepo.assignee === null) {
      buffer.push(fullIssuePerPartnerRepo);
    }

    await createOrSync(fullIssuePerPartnerRepo);
  }
  return buffer.filter((issue) => issue !== null) as GitHubIssue[];

  async function createOrSync(fullIssue: GitHubIssue) {
    const partnerIdMatchIssue: GitHubIssue | null = getIssueByLabel(directoryIssues, `id: ${fullIssue.node_id}`);

    // adding www creates a link to an issue that does not count as a mention
    // helps with preventing a mention in partner's repo especially during testing
    const body = (await checkIfForked()) ? fullIssue.html_url.replace("https://github.com", "https://www.github.com") : fullIssue.html_url;

    if (partnerIdMatchIssue) {
      // if it exists in the Directory, then update it
      await syncDirectoryIssue({
        directoryIssues: fullIssuesPerPartnerRepo,
        directoryIssue: fullIssue,
        url: partnerRepoUrl,
        remoteFullIssue: partnerIdMatchIssue,
      });
    } else {
      // if it doesn't exist in the Directory, then create it
      await newDirectoryIssue(fullIssue, partnerRepoUrl, body, twitterMap);
    }

    return partnerIdMatchIssue;
  }
}
