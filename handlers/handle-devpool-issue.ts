import { getDevpoolIssueLabels } from "../helpers/issue";
import { areEqual, applyUnavailableLabelToDevpoolIssue } from "../helpers/utils";
import { GitHubIssue, LABELS, GitHubLabel } from "../types/github";
import { applyMetaChanges, applyStateChanges } from "./state-updates";

export async function handleDevPoolIssue(
  projectIssues: GitHubIssue[],
  projectIssue: GitHubIssue,
  projectUrl: string,
  devpoolIssue: GitHubIssue,
  isFork: boolean
) {
  // remove the unavailable label as getDevpoolIssueLabels() adds it and statitics rely on it
  const labelRemoved = getDevpoolIssueLabels(projectIssue, projectUrl).filter((label) => label != LABELS.UNAVAILABLE);
  const originals = devpoolIssue.labels.map((label) => (label as GitHubLabel).name);
  const hasChanges = !areEqual(originals, labelRemoved);
  const hasNoPriceLabels = !(projectIssue.labels as GitHubLabel[]).some((label) => label.name.includes(LABELS.PRICE));

  let shouldUpdateBody = false;

  if (!isFork && devpoolIssue.body != projectIssue.html_url) {
    // not a fork, so body uses https://github.com
    shouldUpdateBody = true;
  } else if (isFork && devpoolIssue.body != projectIssue.html_url.replace("https://", "https://www.")) {
    // it's a fork, so body uses https://www.github.com
    shouldUpdateBody = true;
  }

  const metaChanges = {
    // the title of the issue has changed
    title: devpoolIssue.title != projectIssue.title,
    // the issue url has updated
    body: shouldUpdateBody,
    // the price/priority labels have changed
    labels: hasChanges,
  };

  await applyMetaChanges(metaChanges, devpoolIssue, projectIssue, isFork, labelRemoved, originals);

  const newState = await applyStateChanges(projectIssues, projectIssue, devpoolIssue, hasNoPriceLabels);

  await applyUnavailableLabelToDevpoolIssue(
    projectIssue,
    devpoolIssue,
    metaChanges,
    labelRemoved,
    originals,
    newState ?? (devpoolIssue.state as "open" | "closed")
  );
}
