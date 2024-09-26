import { getAllIssues, getIssueByLabel, getRepoCredentials, GitHubIssue, newDirectoryIssue, syncIssueMetaData as syncDirectoryIssue } from "./directory";
import { TwitterMap } from "./initialize-twitter-map";

export async function syncPartnerRepoIssues({
  partnerRepoUrl,
  isFork,
  directoryPreviewIssues,
  twitterMap,
}: {
  partnerRepoUrl: string;
  isFork: boolean;
  directoryPreviewIssues: GitHubIssue[];
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
    const partnerIdMatchIssue: GitHubIssue | null = getIssueByLabel(directoryPreviewIssues, `id: ${fullIssue.node_id}`);

    // adding www creates a link to an issue that does not count as a mention
    // helps with preventing a mention in partner's repo especially during testing
    const body = isFork ? fullIssue.html_url.replace("https://github.com", "https://www.github.com") : fullIssue.html_url;

    if (partnerIdMatchIssue) {
      // if it exists in the devpool, then update it
      await syncDirectoryIssue({
        previewIssues: fullIssuesPerPartnerRepo,
        previewIssue: fullIssue,
        url: partnerRepoUrl,
        remoteFullIssue: partnerIdMatchIssue,
        isFork,
      });
      // allFullIssues.push(partnerIdMatchIssue);
    } else {
      // if it doesn't exist in the devpool, then create it
      await newDirectoryIssue(fullIssue, partnerRepoUrl, body, twitterMap);
    }

    return partnerIdMatchIssue;
  }
}
