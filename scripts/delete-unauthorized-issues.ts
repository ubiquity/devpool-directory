import { IssueRemover } from "../types/issue-remover";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const issueRemover = new IssueRemover();
  await issueRemover.deleteUnauthedIssues();
}

main().catch(console.error);
