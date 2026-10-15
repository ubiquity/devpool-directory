#!/usr/bin/env -S node --enable-source-maps
import process from "node:process";
import { getOctokitWrite, getOctokitRead, getOctokitDelete } from "../github/client";

async function main() {
  const owner = process.env.DIRECTORY_OWNER || (process.env.GITHUB_REPOSITORY?.split("/")[0] ?? "");
  const repo = process.env.DIRECTORY_REPO || (process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "");
  if (!owner || !repo) throw new Error("DIRECTORY_OWNER and DIRECTORY_REPO required");
  const target = `${owner}/${repo}`;
  const guard = process.env.WRITE_TARGET_REPO;
  if (guard && guard !== target) throw new Error(`write-blocked: target ${target} != enforced ${guard}`);

  // Verificar que el APP_ID está configurado
  const appId = process.env.APP_ID;
  if (!appId) throw new Error("APP_ID env must be set for authorization");

  const input = (process.env.NUMBERS || "").trim();
  if (!input) throw new Error("NUMBERS env must be a comma-separated list of issue numbers");
  const numbers = input.split(/[\s,]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n));
  if (!numbers.length) throw new Error("No valid issue numbers provided");

  const okRead = getOctokitRead();
  const okWrite = getOctokitWrite();
  const okDelete = getOctokitDelete();
  const query = "mutation($id:ID!){ deleteIssue(input:{issueId:$id}){ clientMutationId } }";

  let deleted = 0;
  const failures: Array<{ number: number; reason: string }> = [];
  for (const issue_number of numbers) {
    try {
      const { data } = await (okRead as any).issues.get({ owner, repo, issue_number });
      const node_id = (data as any).node_id;
      const author = (data as any).user?.login;

      // Verificar que el autor es el bot autorizado
      if (author !== "devpool-directory-superintendent[bot]") {
        failures.push({ number: issue_number, reason: "unauthorized author" });
        continue;
      }

      if (!node_id) { failures.push({ number: issue_number, reason: "missing node_id" }); continue; }
      const res = await (okDelete as any).request("POST /graphql", { query, variables: { id: node_id } });
      const ok = Boolean((res as any)?.data?.deleteIssue);
      // Verify by fetching again
      let gone = false;
      try {
        await (okRead as any).issues.get({ owner, repo, issue_number });
        gone = false;
      } catch {
        gone = true;
      }
      if (!ok || !gone) {
        failures.push({ number: issue_number, reason: ok ? "verify-failed" : "graphql-no-deleteIssue" });
      } else {
        deleted++;
      }
    } catch (e: any) {
      failures.push({ number: issue_number, reason: String(e?.message || e) });
    }
  }
  console.log(JSON.stringify({ target, requested: numbers, deleted, failures }));
}

main().catch((err) => { console.error(err); process.exit(1); });