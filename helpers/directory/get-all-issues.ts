import { octokit } from "./directory";

export async function getAllIssues(ownerName: string, repoName: string) {
  let issues: IssueNode[] = [];
  let hasNextPage = true;
  let endCursor: string | null = null;

  while (hasNextPage) {
    const query = `
      query ($ownerName: String!, $repoName: String!, $after: String) {
        repository(owner: $ownerName, name: $repoName) {
          isArchived
          issues(first: 100, after: $after, states: [OPEN, CLOSED]) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              number
              title
              body
              createdAt
              updatedAt
              closedAt
              author {
                login
              }
              labels(first: 10) {
                nodes {
                  name
                }
              }
              comments {
                totalCount
              }
            }
          }
        }
      }
    `;

    const variables = {
      ownerName,
      repoName,
      after: endCursor,
    };

    const response: QueryData = await octokit.graphql(query, variables);

    // Check if the repository is archived
    if (response.repository.isArchived) {
      return []; // Return an empty array for archived repositories
    }
    // Append the fetched issues
    issues = issues.concat(response.repository.issues.nodes);

    // Update pagination info
    hasNextPage = response.repository.issues.pageInfo.hasNextPage;
    endCursor = response.repository.issues.pageInfo.endCursor;
  }

  return issues;
}

interface IssueNode {
  id: string;
  number: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: {
    login: string;
  };
  labels: { nodes: { name: string }[] };
  comments: {
    totalCount: number;
  };
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string;
}

interface IssuesData {
  pageInfo: PageInfo;
  nodes: IssueNode[];
}

interface Repository {
  isArchived: boolean;
  issues: IssuesData;
}

interface QueryData {
  repository: Repository;
}
