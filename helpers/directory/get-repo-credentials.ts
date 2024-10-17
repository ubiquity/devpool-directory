/**
 * Returns owner and repository names from a project URL
 * @param projectUrl project URL
 * @returns array of owner and repository names
 */

export function getRepoCredentials(projectUrl: string) {
  const urlObject = new URL(projectUrl);
  const urlPath = urlObject.pathname.split("/");
  const ownerName = urlPath[1];
  const repoName = urlPath[2];
  if (!ownerName || !repoName) {
    throw new Error(`Missing owner name or repo name in [${projectUrl}]`);
  }
  return [ownerName, repoName];
}
