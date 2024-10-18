import { LABELS } from "./src/directory/directory";
import { ensureLabelExists } from "./src/directory/label-utils";
import { gitPush } from "./src/git";
import { main } from "./src/main";

/**
 * Main function
 * TODO: retry on rate limit error
 * TODO: handle project deletion
 */

async function runMainAndPush() {
  try {
    await ensureLabelExists(LABELS.UNAVAILABLE, "ededed", "Indicates the issue is currently assigned and unavailable.");
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
