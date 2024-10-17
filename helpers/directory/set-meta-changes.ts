import { checkIfForked } from "./check-if-forked";
import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, GitHubIssue, octokit } from "./directory";

export async function setMetaChanges({
  metaChanges,
  remoteFullIssue,
  directoryIssue,
  labelRemoved,
  originalLabels,
}: {
  metaChanges: { title: boolean; body: boolean; labels: boolean };
  remoteFullIssue: GitHubIssue;
  directoryIssue: GitHubIssue;
  labelRemoved: string[];
  originalLabels: string[];
}) {
  const shouldUpdate = metaChanges.title || metaChanges.body || metaChanges.labels;

  if (shouldUpdate) {
    let newBody;

    const isForked = await checkIfForked();

    if (isForked) {
      const body = remoteFullIssue.body;
      if (body) {
        newBody = (remoteFullIssue.body as string).replace("https://www.github.com", "https://github.com");
      }
    } else {
      newBody = remoteFullIssue.body;
    }

    try {
      await octokit.rest.issues.update({
        owner: DEVPOOL_OWNER_NAME,
        repo: DEVPOOL_REPO_NAME,
        issue_number: remoteFullIssue.number,
        title: metaChanges.title ? directoryIssue.title : remoteFullIssue.title,
        body: newBody,
        labels: metaChanges.labels ? labelRemoved : originalLabels,
      });
    } catch (err) {
      console.error(err);
    }

    console.log(`Updated metadata: ${remoteFullIssue.html_url} - (${directoryIssue.html_url})`, metaChanges);
  }
}
