import { checkIfForked } from "./check-if-forked";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, octokit } from "./directory";
import { MetadataInterface } from "./sync-issue-meta-data";

export async function setMetaChanges({ metaChanges, partnerIssue, directoryIssue, labelRemoved, originalLabels }: MetadataInterface) {
  const shouldUpdate = metaChanges.title || metaChanges.body || metaChanges.labels;

  if (shouldUpdate) {
    let directoryIssueBody = partnerIssue.html_url;
    const isFork = await checkIfForked();
    if (isFork) {
      directoryIssueBody = partnerIssue.html_url.replace("https://github.com", "https://www.github.com");
    }

    try {
      await octokit.rest.issues.update({
        owner: DEVPOOL_OWNER_NAME,
        repo: DEVPOOL_REPO_NAME,
        issue_number: directoryIssue.number,
        title: directoryIssue.title,
        body: directoryIssueBody,
        labels: metaChanges.labels ? labelRemoved : originalLabels,
      });
    } catch (err) {
      console.error(err);
    }

    console.log(`Updated metadata for issue:`, {
      partnerIssueUrl: partnerIssue.html_url,
      directoryIssueUrl: directoryIssue.html_url,
      changes: metaChanges,
    });
  }
}
