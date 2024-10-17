import { checkIfForked } from "./check-if-forked";
import { GitHubIssue, GitHubLabel, LABELS } from "./directory";
import { getDirectoryIssueLabels } from "./get-directory-issue-labels";
import { setMetaChanges } from "./set-meta-changes";
import { setUnavailableLabelToIssue } from "./set-unavailable-label-to-issue";

export async function syncIssueMetaData({ directoryIssue, partnerIssue }: { directoryIssue: GitHubIssue; partnerIssue: GitHubIssue }) {
  // remove the "unavailable" label as this adds it and statistics rely on it
  const labelRemoved = getDirectoryIssueLabels(directoryIssue, partnerIssue.html_url).filter((label) => label != LABELS.UNAVAILABLE);
  const originalLabels = partnerIssue.labels.map((label) => (label as GitHubLabel).name);

  const isFork = await checkIfForked();
  let linkToPartnerIssue = partnerIssue.html_url;
  if (isFork) {
    linkToPartnerIssue = partnerIssue.html_url.replace("https://github.com", "https://www.github.com");
  }

  const metaChanges = {
    title: directoryIssue.title !== partnerIssue.title,
    body: directoryIssue.body !== linkToPartnerIssue,
    labels: !areEqual(originalLabels, labelRemoved),
  };

  await setMetaChanges({
    metaChanges,
    partnerIssue,
    directoryIssue,
    labelRemoved,
    originalLabels,
  });

  await setUnavailableLabelToIssue({
    directoryIssue,
    partnerIssue,
    metaChanges,
    labelRemoved,
    originals: originalLabels,
  });
}

function areEqual(a: string[], b: string[]) {
  return a.sort().join(",") === b.sort().join(",");
}
