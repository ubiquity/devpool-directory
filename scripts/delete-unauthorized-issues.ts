import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { App } from "octokit";
import { execSync } from "child_process";
import dotenv from "dotenv";
dotenv.config();

export class IssueRemover {
  /**
   * Octokit instance using the runner's correctly scoped token.
   */
  runnerOctokit: Octokit;
  /**
   * App instance using the app's private key and app id.
   */
  #app: App;
  /**
   * App authenticated octokit instance.
   */
  #appOctokit: App["octokit"] | null = null;

  constructor() {
    this.runnerOctokit = new Octokit({ auth: process.env.GH_TOKEN });
    const key = process.env.APP_PRIVATE_KEY;
    const id = process.env.APP_ID;
    if (!key || !id) {
      throw new Error("Missing APP_PRIVATE_KEY or APP_ID");
    }
    this.#app = new App({ appId: id, privateKey: key });
    this.#appOctokit = this.#app.octokit;
  }

  /**
   * All issues that are created by bots/users which do not belong
   * to an installation will be deleted.
   */
  async deleteUnauthedIssues() {
    const installations = await this.getInstallations();
    if (!installations || installations.length === 0) {
      console.log("No installations found. Exiting...");
      return;
    }
    // passed in via the workflow file
    const OWNER_REPO = process.env.OWNER_REPO;
    if (!OWNER_REPO) {
      throw new Error("OWNER_REPO not passed in env");
    }

    const [owner, repo] = OWNER_REPO.split("/");

    // get all open devpool issues
    const issues = (await this.runnerOctokit.paginate(this.runnerOctokit.rest.issues.listForRepo, {
      owner,
      repo,
      state: "open",
    })) as RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"];

    // how we map the bot installs to their org
    const allowedBots = new Set(installations.map((install) => install.app_slug));
    // incase the install is to a user account
    const allowedUsers = new Set(installations.map((install) => install.account.id));

    let didDelete = false;

    for (const issue of issues) {
      if (issue.pull_request || issue.state !== "open") {
        continue;
      }
      if (issue.user?.type === "Bot") {
        if (!allowedBots.has(issue.user?.login.split("[bot]")[0])) {
          console.log(`Deleting issue ${issue.html_url} created by bot ${issue.user?.login}`);
          await this.deleteIssue(issue.html_url);
          didDelete = true;
        }
      } else if (issue.user?.type === "User") {
        if (!allowedUsers.has(issue.user?.id)) {
          console.log(`Deleting issue ${issue.html_url} created by user ${issue.user?.login}`);
          await this.deleteIssue(issue.html_url);
          didDelete = true;
        }
      } else {
        console.log(`Issue ${issue.html_url} was not created by a bot or user`);
      }
    }

    if (!didDelete) {
      console.log("No unauthorized issues found. Exiting...");
    }

    return await this.exitProgram();
  }

  async getInstallations() {
    if (!this.#appOctokit) {
      throw new Error("App octokit instance not initialized");
    }
    const installations = await this.#appOctokit.rest.apps.listInstallations();
    return installations.data.map((install) => {
      return {
        account: {
          id: install.account?.id,
          login: install.account && "login" in install.account ? install.account.login : undefined,
        },
        app_slug: install.app_slug,
      };
    });
  }

  async deleteIssue(url: string) {
    const res = execSync(`gh issue delete ${url} --yes`, { encoding: "utf-8" });

    const errorMsgs = ["Resource not accessible by personal access token", "Viewer not authorized to delete"];

    if (errorMsgs.some((msg) => res.includes(msg))) {
      console.error(`Error deleting issue: ${res}`);
      return await this.exitProgram(1);
    }
  }

  async exitProgram(code = 0) {
    process.exit(code);
  }
}

const issueRemover = new IssueRemover();
issueRemover.deleteUnauthedIssues().catch(console.error);
