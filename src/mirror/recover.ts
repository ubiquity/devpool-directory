import type { Octokit } from "@octokit/rest";
import type { MirrorState, PartnerIssue } from "../artifacts/types";
import type { IndexMap } from "./reconcile";
import pLimit from "p-limit";

type Directory = { owner: string; repo: string };
type Closure = { number: number; nodeId: string; reason: "completed" | "not_planned" };

function partnerUrl(body: string): string | null {
  const canonical = body.trim().replace("https://www.github.com/", "https://github.com/");
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/.test(canonical) ? canonical : null;
}

export async function recoverMirrorState(
  read: Octokit,
  directory: Directory,
  issues: Record<string, PartnerIssue>,
  savedIndex: IndexMap,
  previous: MirrorState,
  fetchedNodeIds: ReadonlySet<string> = new Set()
) {
  const index: IndexMap = { ...savedIndex };
  const state: MirrorState = { ...previous };
  for (const [node, entry] of Object.entries(previous)) {
    if (!index[node] && entry.directory_issue_number && entry.directory_issue_url) {
      index[node] = { number: entry.directory_issue_number, url: entry.directory_issue_url };
    }
  }
  const mirrors = await read.paginate(read.issues.listForRepo, { ...directory, state: "all", per_page: 100 });
  const byUrl = new Map<string, (typeof mirrors)[number]>();
  for (const mirror of mirrors) {
    if (mirror.pull_request) continue;
    const url = partnerUrl(mirror.body ?? "");
    if (!url) {
      if (mirror.state === "open") throw new Error(`unrecognized open mirror body: #${mirror.number}`);
      continue;
    }
    if (mirror.user?.login !== "devpool-directory-superintendent[bot]") {
      throw new Error(`untrusted mirror author: #${mirror.number}`);
    }
    const kept = byUrl.get(url);
    if (!kept || mirror.number < kept.number) byUrl.set(url, mirror);
    if (kept) console.warn(`[recover] duplicate mirrors for ${url}; preserving both issues`);
  }
  const knownByUrl = new Map(Object.values(issues).map((issue) => [issue.url, issue]));
  const closures: Closure[] = [];
  const cancelledNodeIds: string[] = [];
  const unchangedClosed = new Set<string>();
  const limit = pLimit(6);
  await Promise.all(Array.from(byUrl, ([url, mirror]) => limit(async () => {
    let source = knownByUrl.get(url);
    let nodeId = source?.node_id;
    let reason: Closure["reason"] = "completed";
    if (mirror.state === "open" && (!source || (source.state === "open" && !fetchedNodeIds.has(source.node_id)))) {
      const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/.exec(url)!;
      const data = await read.issues.get({ owner: match[1], repo: match[2], issue_number: Number(match[3]) })
        .then((response) => response.data)
        .catch((cause) => { throw new Error(`cannot verify source of mirror #${mirror.number}: ${url}`, { cause }); });
      if (data.pull_request || partnerUrl(data.html_url) !== url || !data.node_id) {
        throw new Error(`source identity changed for mirror #${mirror.number}`);
      }
      nodeId = data.node_id;
      if (source && source.node_id !== nodeId) throw new Error(`source node changed for mirror #${mirror.number}`);
      if (data.state === "closed") {
        reason = data.state_reason === "not_planned" ? "not_planned" : "completed";
        closures.push({ number: mirror.number, nodeId, reason });
        if (reason === "not_planned") cancelledNodeIds.push(nodeId);
        else if (source) {
          source = { ...source, state: "closed", updated_at: data.updated_at };
          issues[nodeId] = source;
        }
      } else if (!source) {
        throw new Error(`open source is absent from sync history: ${url}`);
      }
    }
    if (!nodeId) return;
    index[nodeId] = { number: mirror.number, url: mirror.html_url };
    state[nodeId] = {
      ...(state[nodeId] ?? { assigned: false, assignees: [] }),
      directory_issue_number: mirror.number,
      directory_issue_url: mirror.html_url
    };
    const labels = (mirror.labels ?? []).map((label) => typeof label === "string" ? label : label.name).sort();
    if (source?.state === "closed" && mirror.state === "closed" && mirror.title === source.title && mirror.body === source.url &&
      JSON.stringify(labels) === JSON.stringify([...source.labels].sort())) {
      unchangedClosed.add(nodeId);
    }
    if (!savedIndex[nodeId] && !previous[nodeId]?.directory_issue_number && !closures.some((closure) => closure.nodeId === nodeId) && source?.state === "open" && !source.labels.some((label) => /^Price:\s*/.test(label))) {
      throw new Error(`unpriced mirror requires separate cleanup: #${mirror.number}`);
    }
  })));
  return { index, state, closures, cancelledNodeIds, unchangedClosed };
}

export async function applyRecoveredClosures(write: Octokit, directory: Directory, closures: Closure[], dryRun: boolean) {
  const target = `${directory.owner}/${directory.repo}`;
  if (process.env.WRITE_TARGET_REPO && process.env.WRITE_TARGET_REPO !== target) throw new Error(`write-blocked: target ${target}`);
  for (const closure of closures) {
    if (!dryRun) await write.issues.update({ ...directory, issue_number: closure.number, state: "closed", state_reason: closure.reason });
  }
}
