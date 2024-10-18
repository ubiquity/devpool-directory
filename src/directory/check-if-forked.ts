import { DEVPOOL_OWNER_NAME } from "./directory";

//=============
// Helpers
//=============
/**
 * Stops forks from spamming real Ubiquity issues with links to their forks
 * @returns true if the authenticated user is Ubiquity
 */

export async function checkIfForked() {
  // derived from `${{ github.repository_owner }}` from the yml workflow, which reads the owner of the repository
  return DEVPOOL_OWNER_NAME !== "ubiquity";
}
