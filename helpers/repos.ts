import optInOptOut from "../opt.json";
import { getRepoUrls } from "./issue";
import { projects } from "./github";

export async function getProjectUrls(opt: typeof optInOptOut = optInOptOut) {
  const projectUrls = new Set<string>(projects.urls);

  for (const orgOrRepo of opt.in) {
    const urls: string[] = await getRepoUrls(orgOrRepo);
    urls.forEach((url) => projectUrls.add(url));
  }

  for (const orgOrRepo of opt.out) {
    const len = orgOrRepo.split("/").length;

    if (len === 1) {
      // it's an org, delete all org repos in the list
      projectUrls.forEach((url) => {
        if (url.includes(orgOrRepo)) {
          const [owner, repo] = getRepoCredentials(url);
          if (opt.in.includes(`${owner}/${repo}`)) {
            return;
          }
          projectUrls.delete(url);
        }
      });
    } else {
      // it's a repo, delete the repo from the list
      projectUrls.forEach((url) => url === `https://github.com/${orgOrRepo}` && projectUrls.delete(url));
    }
  }

  return projectUrls;
}

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
