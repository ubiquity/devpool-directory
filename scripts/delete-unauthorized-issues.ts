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
   * Check if the newly posted issue is unauthorized and delete it if so.
   */
  async deleteUnauthorizedIssue() {
    const newIssue = returnNewlyPostedIssue();
    const installations = await this.getInstallations();
    if (!installations || installations.length === 0) {
      console.log("No installations found. Exiting...");
      return;
    }

    // how we map the bot installs to their org
    const allowedBots = new Set(installations.map((install) => install.app_slug));
    // incase the install is to a user account
    const allowedUsers = new Set(installations.map((install) => install.account.id));

    if (newIssue.user?.type === "Bot") {
      if (!allowedBots.has(newIssue.user?.login.split("[bot]")[0])) {
        console.log(`Deleting issue ${newIssue.html_url} created by bot ${newIssue.user?.login}`);
        await this.deleteIssue(newIssue.html_url);
      }
    } else if (newIssue.user?.type === "User") {
      if (!allowedUsers.has(newIssue.user?.id)) {
        console.log(`Deleting issue ${newIssue.html_url} created by user ${newIssue.user?.login}`);
        await this.deleteIssue(newIssue.html_url);
      }
    } else {
      console.log(`Issue ${newIssue.html_url} was not created by a bot or user`);
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

function returnNewlyPostedIssue() {
  const issueData = JSON.parse(process.argv[2]);

  // Declare a variable for the issue
  const issue: RestEndpointMethodTypes["issues"]["get"]["response"]["data"] = issueData;

  console.log(`Processing issue #${issue.number}: ${issue.title}`);
  return issue;
}

const issueRemover = new IssueRemover();
issueRemover.deleteUnauthorizedIssue().catch(console.error);
