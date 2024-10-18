import optInOptOut from "../../opt.json";
import { projects } from "./directory";
import { getRepoCredentials } from "./get-repo-credentials";
import { getRepoUrls } from "./get-repo-urls";

export async function getPartnerUrls(opt: typeof optInOptOut = optInOptOut) {
  const partnerUrls = new Set<string>(projects.urls);

  for (const orgOrRepo of opt.in) {
    const urls: string[] = await getRepoUrls(orgOrRepo);
    urls.forEach((url) => partnerUrls.add(url));
  }

  for (const orgOrRepo of opt.out) {
    const len = orgOrRepo.split("/").length;

    if (len === 1) {
      // it's an org, delete all org repos in the list
      partnerUrls.forEach((url) => {
        if (url.includes(orgOrRepo)) {
          const [owner, repo] = getRepoCredentials(url);
          if (opt.in.includes(`${owner}/${repo}`)) {
            return;
          }
          partnerUrls.delete(url);
        }
      });
    } else {
      // it's a repo, delete the repo from the list
      partnerUrls.forEach((url) => url === `https://github.com/${orgOrRepo}` && partnerUrls.delete(url));
    }
  }

  return partnerUrls;
}
