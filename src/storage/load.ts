import { Octokit } from "@octokit/rest";

export async function loadArtifact<T = any>(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<T | null> {
  let data: unknown;
  try {
    const resp = await octokit.repos.getContent({ owner, repo, path, ref });
    data = resp.data;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
  if (!data || Array.isArray(data)) throw new Error(`artifact is not a file: ${path}`);
  const file = data as { content?: string; encoding?: string; sha?: string };
  let content = file.content;
  if (file.encoding === "none" || typeof content !== "string") {
    if (!file.sha) throw new Error(`artifact has no readable content: ${path}`);
    const { data: blob } = await octokit.git.getBlob({ owner, repo, file_sha: file.sha });
    if (blob.encoding !== "base64") throw new Error(`unsupported artifact encoding: ${path}`);
    content = blob.content;
  } else if (file.encoding && file.encoding !== "base64") {
    throw new Error(`unsupported artifact encoding: ${path}`);
  }
  const parsed = JSON.parse(Buffer.from(content, "base64").toString("utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error(`invalid artifact JSON: ${path}`);
  return parsed as T;
}
