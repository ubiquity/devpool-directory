import { IssueRemover } from "../types/issue-remover";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const issueRemover = new IssueRemover();
  issueRemover.deleteUnauthedIssues().catch(console.error);
}

main().catch(console.error);