import { checkIfForked } from "./check-if-forked";
import { GitHubIssue, GitHubLabel, Labels } from "./directory";
import { getDirectoryIssueLabelsFromPartnerIssue } from "./get-directory-issue-labels";
import { setMetaChanges } from "./set-meta-changes";
import { setUnavailableLabelToIssue } from "./set-unavailable-label-to-issue";

export async function syncIssueMetaData({ directoryIssue, partnerIssue }: { directoryIssue: GitHubIssue; partnerIssue: GitHubIssue }) {
  // remove the "unavailable" label as this adds it and statistics rely on it
  const labelRemoved = getDirectoryIssueLabelsFromPartnerIssue(partnerIssue).filter((label) => label != Labels.UNAVAILABLE);
  const originalLabels = partnerIssue.labels.map((label) => (label as GitHubLabel).name);

  const isFork = await checkIfForked();
  let partnerIssueUrl = partnerIssue.html_url;
  if (isFork) {
    partnerIssueUrl = partnerIssue.html_url.replace("https://github.com", "https://www.github.com");
  }

  const metaChanges: MetaChanges = {
    title: directoryIssue.title !== partnerIssue.title,
    body: directoryIssue.body !== partnerIssueUrl,
    labels: !areEqual(originalLabels, labelRemoved),
  };

  const metadata: MetadataInterface = {
    metaChanges,
    partnerIssue,
    directoryIssue,
    labelRemoved,
    originalLabels,
  };
  await setMetaChanges(metadata);
  await setUnavailableLabelToIssue(metadata);
}

function areEqual(a: string[], b: string[]) {
  return a.sort().join(",") === b.sort().join(",");
}

export interface MetadataInterface {
  metaChanges: MetaChanges;
  partnerIssue: GitHubIssue;
  directoryIssue: GitHubIssue;
  labelRemoved: string[];
  originalLabels: string[];
}

interface MetaChanges {
  title: boolean;
  body: boolean;
  labels: boolean;
}
