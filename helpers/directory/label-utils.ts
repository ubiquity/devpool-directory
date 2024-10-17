import { DEVPOOL_OWNER_NAME, DEVPOOL_REPO_NAME, octokit } from "./directory";

// Function to check if a label exists
export async function ensureLabelExists(labelName: string, labelColor: string, labelDescription: string): Promise<void> {
  try {
    // Fetch all labels in the repository
    const labels = await octokit.rest.issues.listLabelsForRepo({
      owner: DEVPOOL_OWNER_NAME,
      repo: DEVPOOL_REPO_NAME,
      per_page: 100,
    });

    // Check if the label already exists
    const isLabelPresent = labels.data.some((label) => label.name === labelName);

    // If the label does not exist, create it
    if (!isLabelPresent) {
      await octokit.rest.issues.createLabel({
        owner: DEVPOOL_OWNER_NAME,
        repo: DEVPOOL_REPO_NAME,
        name: labelName,
        color: "ededed",
        description: labelDescription,
      });
      console.log(`Created label "${labelName}"`);
    }
  } catch (error) {
    console.error(`Error ensuring label "${labelName}" exists:`, error);
    throw error; // Rethrow the error after logging
  }
}
