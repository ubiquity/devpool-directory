import { DEVPOOL_TASK_BODY_REGEX } from "../helpers/constants";
import { octokit, DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME } from "../helpers/github";
import { getIssueLabelValue, getIssueByLabel } from "../helpers/issue";
import { IssueRemover } from "../scripts/delete-unauthorized-issues";
import { GitHubIssue } from "../types/github";
import { graphql } from "@octokit/graphql";

export async function handleNodeIdMismatches(
    devpoolIssue: GitHubIssue,
    projectMap: Map<string, GitHubIssue>,
    devpoolIssues: GitHubIssue[],
    missingPartnerTasks: Set<string>,
    deletedPartnerTasks: Set<string>
) {
    let partnerTaskId = getIssueLabelValue(devpoolIssue, "id:");
    if (!partnerTaskId) {
        // we should delete these issues as they are most likely unofficial bots
        return;
    }
    const issueRemover = new IssueRemover();
    /**
     * If the task is not in the project map, then we need to fetch it
     * although it should be because the map consists of only task
     * node ids that are present in the project issues
     */
    if (!projectMap.has(partnerTaskId)) {
        try {
            // using the node ID, fetch whatever issue it is
            const taskViaGraphQL = await fetchIssueByNodeId(partnerTaskId);
            if (taskViaGraphQL) {
                const taskViaRest = await octokit.rest.issues.get({
                    owner: DEVPOOL_OWNER_NAME,
                    repo: DEVPOOL_REPO_NAME,
                    issue_number: taskViaGraphQL.number,
                });
                projectMap.set(taskViaRest.data.node_id, taskViaRest.data);
            } else {
                await handleMissingTask(partnerTaskId, devpoolIssues, projectMap, missingPartnerTasks);
            }
        } catch (error) {
            let message = "";

            if (typeof error === "string") {
                message = error;
            } else if (error instanceof Error) {
                message = error.message;
            } else if (error && typeof error === "object" && "response" in error) {
                const err = error as { response: { url: string, status: number, data: { message: string } } };
                message = err.response.data.message;
            } else {
                console.error(`Error fetching task with node ID4 ${partnerTaskId}`, error);
            }

            if (message.includes("This issue was deleted")) {
                deletedPartnerTasks.add(partnerTaskId);
            }

            missingPartnerTasks.add(partnerTaskId);
        }
    }


    /**
     * These tasks could not be found by either the project map or the GraphQL fetch
     * so we need to refetch the issue using the task URL from the devpool body
     */
    if (missingPartnerTasks.has(partnerTaskId)) {
        await handleMissingTask(partnerTaskId, devpoolIssues, projectMap, missingPartnerTasks, issueRemover);
    }
}

export async function handleMissingTask(
    partnerTaskId: string,
    devpoolIssues: GitHubIssue[],
    projectMap: Map<string, GitHubIssue>,
    missingPartnerTasks: Set<string>,
    issueRemover: IssueRemover
) {
    // use the old partnerTaskId to find the issue amongst the devpool issues
    const devpoolIssue = getIssueByLabel(devpoolIssues, `id: ${partnerTaskId}`);
    // this should always be true
    if (devpoolIssue) {
        const match = devpoolIssue.body?.match(DEVPOOL_TASK_BODY_REGEX);

        if (match?.groups) {
            const { owner, repo, number } = match.groups;
            let issue;

            try {
                issue = await octokit.rest.issues.get({
                    owner,
                    repo,
                    issue_number: parseInt(number),
                });
            } catch (e) {
                console.error(`Error fetching issue with number ${number}:`, e);
            }

            if (!issue || !issue.data || issue.status !== 200) {
                // if no issue is found, we should probably delete these as
                // most likely org/owner/repo/issue has been deleted or moved.
                return;
            }

            const { node_id, html_url, title } = issue.data;
            // update the project map with the new node ID
            projectMap.set(node_id, issue.data);
            // remove the task from the missing set
            missingPartnerTasks.delete(partnerTaskId);

            console.log(`Found missing task with node ID ${partnerTaskId} and updated the project map with the new node ID ${node_id}`, {
                partnerTaskId,
                node_id,
                html_url,
                title
            });

            // update the devpool issue with the new node ID
            await octokit.rest.issues.deleteLabel({
                owner: DEVPOOL_OWNER_NAME,
                repo: DEVPOOL_REPO_NAME,
                issue_number: devpoolIssue.number,
                name: `id: ${partnerTaskId}`
            });

            await octokit.rest.issues.createLabel({
                owner: DEVPOOL_OWNER_NAME,
                repo: DEVPOOL_REPO_NAME,
                issue_number: devpoolIssue.number,
                name: `id: ${node_id}`
            });
        } else {

            console.log(`Attempted to locate issue after failing to find it in the project map, but failed to find it in the devpool body`, {
                partnerTaskId,
                devpoolIssueUrl: devpoolIssue.html_url,
                devpoolIssueBody: devpoolIssue.body
            });

            console.log(`Deleting ${devpoolIssue.html_url}`);
            await issueRemover.deleteIssue(devpoolIssue.html_url)
        }
    } else {
        console.log(`Found a task which has an incorrect partnerTaskId, but could not find the issue in the devpool issues`, {
            partnerTaskId,
        });
    }
}

export async function fetchIssueByNodeId(nodeId: string) {
    type IssueNode = {
        __typename: string;
        id: string;
        number: number;
        title: string;
        body: string;
        state: string;
        url: string;
    };

    type IssueNodeResponse = {
        node: IssueNode;
    };

    const query = `
    query($nodeId: ID!) {
      node(id: $nodeId) {
        ... on Issue {
          __typename
          id
          number
          title
          body
          state
          url
        }
      }
    }
  `;

    try {
        const result = await graphql<IssueNodeResponse>(query, {
            nodeId,
            headers: {
                authorization: `token ${process.env.DEVPOOL_GITHUB_API_TOKEN}`,
            },
        });

        return result.node;
    } catch (error) {
        if (typeof error === "object" && error && "errors" in error) {
            const err = error as { errors: { message: string }[] };
            console.error(`Error fetching issue with node ID ${nodeId}:`, err.errors);
        }
    }
}