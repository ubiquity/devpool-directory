import { octokit } from "./directory";

/**
 * Returns all org repositories urls or owner/repo url
 * @param orgOrRepo org or repository name
 * @returns array of repository urls
 */

export async function getRepoUrls(orgOrRepo: string) {
  if (!orgOrRepo) {
    console.warn("No org or repo provided: ", orgOrRepo);
    return [];
  }

  if (orgOrRepo.startsWith("/") || orgOrRepo.endsWith("/")) {
    console.warn("Invalid org or repo provided: ", orgOrRepo);
    return [];
  }

  const params = orgOrRepo.split("/");
  let repos: string[] = [];
  try {
    switch (params.length) {
      case 1: // org
        try {
          const res = await octokit.paginate("GET /orgs/{org}/repos", {
            org: orgOrRepo,
          });
          repos = res.map((repo) => repo.html_url);
          console.info(`Getting ${orgOrRepo} org repositories: ${repos.length}`);
        } catch (error: unknown) {
          console.warn(`Getting ${orgOrRepo} org repositories failed: ${error}`);
          throw error;
        }
        break;
      case 2: // owner/repo
        try {
          const res = await octokit.rest.repos.get({
            owner: params[0],
            repo: params[1],
          });

          if (res.status === 200) {
            repos.push(res.data.html_url);
            console.info(`Getting repo ${params[0]}/${params[1]}: ${res.data.html_url}`);
          } else console.warn(`Getting repo ${params[0]}/${params[1]} failed: ${res.status}`);
        } catch (error: unknown) {
          console.warn(`Getting repo ${params[0]}/${params[1]} failed: ${error}`);
          throw error;
        }
        break;
      default:
        console.warn(`Neither org or nor repo GitHub provided: ${orgOrRepo}.`);
    }
  } catch (err) {
    console.error(err);
  }

  return repos;
}
