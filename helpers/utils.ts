/**
 * Stops forks from spamming real Ubiquity issues with links to their forks
 * @returns true if the authenticated user is Ubiquity
 */
export async function checkIfForked(user: string) {
  return user !== "ubiquity";
}