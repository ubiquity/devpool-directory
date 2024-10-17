import { GitHubIssue, GitHubLabel, LABELS } from "./directory";
import { getDirectoryIssueLabels } from "./get-directory-issue-labels";
import { setMetaChanges } from "./set-meta-changes";
import { setStateChanges } from "./set-state-changes";
import { setUnavailableLabelToIssue } from "./set-unavailable-label-to-issue";

export async function syncIssueMetaData({
  directoryIssues,
  directoryIssue,
  url,
  remoteFullIssue,
}: {
  directoryIssues: GitHubIssue[];
  directoryIssue: GitHubIssue;
  url: string;
  remoteFullIssue: GitHubIssue;
}) {
  // remove the "unavailable" label as this adds it and statistics rely on it
  const labelRemoved = getDirectoryIssueLabels(directoryIssue, url).filter((label) => label != LABELS.UNAVAILABLE);
  const originalLabels = remoteFullIssue.labels.map((label) => (label as GitHubLabel).name);
  const hasChanges = !areEqual(originalLabels, labelRemoved);
  const metaChanges = {
    title: directoryIssue.title !== remoteFullIssue.title,
    body: directoryIssue.body !== remoteFullIssue.body,
    labels: !areEqual(originalLabels, labelRemoved),
  };

  if (hasChanges) {
    await setMetaChanges({ metaChanges, remoteFullIssue, directoryIssue, labelRemoved, originalLabels });
  }

  const newState = await setStateChanges(directoryIssues, directoryIssue, remoteFullIssue);

  await setUnavailableLabelToIssue(
    directoryIssue,
    remoteFullIssue,
    metaChanges,
    labelRemoved,
    originalLabels,
    newState ?? (remoteFullIssue.state as "open" | "closed")
  );
}

function areEqual(a: string[], b: string[]) {
  return a.sort().join(",") === b.sort().join(",");
}
