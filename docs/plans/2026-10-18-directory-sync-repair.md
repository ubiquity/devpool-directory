# Directory sync repair

## Objective and acceptance

Fix pagination, large-file history loading, and durable mirror identity preservation; recover lost mappings and prove a production sync closes stale mirrors without recreating them.

The user authorized this goal and its fix on 2026-10-18. The parent is the orchestrator; workers implement and validate. Follow root AGENTS.md, especially App-only issue/artifact writes and WRITE_TARGET_REPO. Existing unrelated forks and branches remain untouched. No secret extraction, new product flags/environment variables, or user-token issue writes are authorized. Recovery must preserve existing issues and must not invoke destructive cleanup. Existing duplicate cleanup policy is retained, but automatic cleanup is held during recovery by a documented workflow condition.

## Current evidence

Production repository: /home/codex/repos/devpool-directory/devpool-directory, branch development, base b36dbdea3e5d657e292556d944bbdf830382cb85. Fresh task clone is clean and has no competing writers. Root AGENTS.md SHA-256 is 78f47e88cafdc0576eb62fb1636ebd0222dca515b3fbae756c61c573902301f0. There is no existing DECISIONS.md. Existing /home/codex/repos/0x4007 forks are different repositories and must remain untouched.

Both GraphQL pagination loops test an uninitialized cursor before advancing it. The 2.4 MB issues-map.json receives an empty inline Contents API response; aggregate silently resets the map. Replacement mirror state then drops older links, and closures require the missing links. Source ai.ubq.fi#733/mirror#6165 and source#785/mirror#6171 are confirmed stale examples. Scratch evidence is under /tmp/devpool-freshness-20261018/sync_freshness and /tmp/devpool-workflow-20261018.

## Implementation contracts

All modules start from the exact base above and preserve public fetch/type/storage interfaces. Their owned surfaces are disjoint. No worker creates extra lanes, commits, pushes, or performs production writes. Parent owns commits/integration. Integration order is m01-fetch, m02-state, then m03-pipeline; required full validation runs once in canonical after all writers settle.

- m01-fetch owns src/fetch-graphql.ts, src/mirror/sync.ts, and tests/fetch-pagination.test.ts plus tests/sync-failure.test.ts. Correct issues and PR pagination/cutoff, and propagate fetch failures before advancing successful metadata. Preserve existing source eligibility and schemas. Validate more than 100 items, cutoff behavior, and failed fetch/watermark behavior.
- m02-state owns src/storage/load.ts, src/cli/aggregate.ts, src/cli/plan.ts, src/cli/backfill.ts where required, a narrowly scoped src/mirror/recover.ts helper if needed, and tests/storage-load.test.ts plus tests/mirror-recovery.test.ts. Use authenticated large-file retrieval; only a genuine missing file may become empty state. Load persisted index and preserve prior mappings across omitted input and failures. Discover existing App-authored directory mirrors through fully paginated listing, canonical URL identity, before creates. Reuse oldest identities deterministically; no recovery deletions. Exact source reads may recover closed/cancelled sources absent from ingested history without adding cancelled records to rewards or public artifacts. Propagate reconciliation failures rather than publishing success. Keep changes bounded to sync and recovery; avoid general refactors.
- m03-pipeline owns .github/workflows/matrix-sync.yml, .github/workflows/cleanup-dedup.yml, the existing test workflow, package.json only for a test command, and docs/DECISIONS.md. Supply issues-map.json to shards, stop failure masking, prevent aggregate publication after failed shards, respect App-only writes, and hold automatic destructive cleanup during recovery. Wire the new regressions using the repository's existing Node/TypeScript tooling and node:test, preferably npx tsx --test tests/*.test.ts; do not add a separate runtime or test framework. Document durable state and recovery decisions and the scoped cleanup hold. Inspect existing final-cleanup and Twitter behavior to make the release safe; do not introduce new product options.

## Validation and release

Workers use /home/codex/.codex/agents/assets/test-evidence/evidence.ts for registered capture-mode checks, retaining exact commands, exit statuses, source revision, and receipt references. Focused regressions must demonstrate baseline failure where practical; no production writes from tests. Tests cover multi-page fetch, large artifacts, malformed/forbidden loads, stable identities across incremental omission, same-issue closure recovery, failure propagation, and repeated recovery. No formatter mutation is pre-authorized; match existing style manually.

Required final checks: new regression command, npm run build, npm run bundle:all, and applicable CI checks. Attribute pre-existing Knip/Jest/CSpell issues against the pristine base instead of broadening the repair silently. Run actual configured codex review, inspect actionable findings, and follow the bounded delivery loop. Publish one PR, wait for required checks, merge while preserving worker-tip ancestry, and prove the shipped branch contains all accepted work.

Production acceptance uses the existing Matrix Sync full_resync input and App credentials in GitHub Actions. First inspect the exact candidate for destructive cleanup and unsolicited Twitter side effects; use existing supported controls to keep the recovery focused. Capture initial mirror identities, source statuses, duplicate groups, artifact counts, and storage revision. Run the repaired full sync and verify #6165/#6171 keep their issue numbers and become closed when sources remain closed. Compare the complete open mirror set to eligible sources and verify missing mappings recovered. Verify a subsequent incremental run retains identities and state, and no duplicate burst or hidden failed shard occurs. Do not treat green CI or artifact timestamps alone as acceptance.

## Completion

Complete only after canonical publication and production acceptance. Record exact shipped SHA, PR/run URLs, test/review evidence, recovered status/counts, and any remaining limitations. Settle workers/jobs and remove only clean task-created integrated local lanes; retain remote branches unless deletion is explicitly authorized. The goal remains active if required work is incomplete.

## Canonical goal identity

```json
{
  "plan": "/home/codex/repos/devpool-directory/devpool-directory/docs/plans/2026-10-18-directory-sync-repair.md",
  "root": "/home/codex/repos/devpool-directory/devpool-directory",
  "base": "b36dbdea3e5d657e292556d944bbdf830382cb85",
  "canonical": {
    "lane": "2026-10-18-directory-sync-repair-geb1be54d99",
    "path": "/home/codex/repos/devpool-directory/devpool-directory/.codex-worktrees/2026-10-18-directory-sync-repair-geb1be54d99",
    "branch": "codex/2026-10-18-directory-sync-repair-geb1be54d99"
  },
  "modules": {
    "m01-fetch": {
      "lane": "2026-10-18-directory-sync-repair-m01-fetch-adaeef72018",
      "path": "/home/codex/repos/devpool-directory/devpool-directory/.codex-worktrees/2026-10-18-directory-sync-repair-m01-fetch-adaeef72018",
      "branch": "codex/2026-10-18-directory-sync-repair-m01-fetch-adaeef72018"
    },
    "m02-state": {
      "lane": "2026-10-18-directory-sync-repair-m02-state-ad42f136f2a",
      "path": "/home/codex/repos/devpool-directory/devpool-directory/.codex-worktrees/2026-10-18-directory-sync-repair-m02-state-ad42f136f2a",
      "branch": "codex/2026-10-18-directory-sync-repair-m02-state-ad42f136f2a"
    },
    "m03-pipeline": {
      "lane": "2026-10-18-directory-sync-repair-m03-pipeline-af14be6ef0a",
      "path": "/home/codex/repos/devpool-directory/devpool-directory/.codex-worktrees/2026-10-18-directory-sync-repair-m03-pipeline-af14be6ef0a",
      "branch": "codex/2026-10-18-directory-sync-repair-m03-pipeline-af14be6ef0a"
    }
  }
}
```

Goal: As orchestrator, use canonical worktree 2026-10-18-directory-sync-repair-geb1be54d99 at /home/codex/repos/devpool-directory/devpool-directory/.codex-worktrees/2026-10-18-directory-sync-repair-geb1be54d99 on branch codex/2026-10-18-directory-sync-repair-geb1be54d99; read AGENTS.md and /home/codex/repos/devpool-directory/devpool-directory/docs/plans/2026-10-18-directory-sync-repair.md in full, then repair and recover directory sync through execution workers and verify production closure reconciliation, keeping each write module in its recorded lane and integration and final validation in canonical.
