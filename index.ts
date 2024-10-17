import { gitPush } from "./helpers/git";
import { main } from "./helpers/main";

/**
 * Main function
 * TODO: retry on rate limit error
 * TODO: handle project deletion
 */

async function runMainAndPush() {
  try {
    await main();
  } catch (error) {
    console.error("Error in main execution:", error);
  }

  try {
    await gitPush();
  } catch (error) {
    console.error("Error during git push:", error);
  }
}

runMainAndPush().catch((error) => {
  console.error("Unhandled error in runMainAndPush:", error);
  process.exit(1);
});
