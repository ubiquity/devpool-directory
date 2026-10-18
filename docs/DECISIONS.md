# Decisions

## 2026-10-18: Directory sync state and recovery

Persisted issue history and mirror mappings are durable state. Incremental omissions must preserve them, and only a genuine missing artifact may load as empty state. Large files use authenticated raw retrieval rather than the Contents API's inline payload. Fully paginated source fetches and existing mirror bodies recover lost identities before any creation.

A failed fetch, invalid artifact, reconciliation failure, or missing shard output fails the sync. Aggregate publication depends on every shard succeeding; a failed run must not publish a successful watermark. Scheduled and manual runs for the same branch execute serially.

The recovery audit found unique human implementation and payout comments on directory issues #5931 and #5969. Preserve the existing duplicate pairs #5076/#5931 and #5839/#5969 unchanged under the protection of user-owned state. Deleting these discussion-bearing mirrors is outside this sync repair's scope. Recovery acceptance compares the unique public eligible source URL set with the open mirror URL set, requires no new duplicates, and retains these two baseline pairs.

The duplicate cleanup job remains available only through its existing manual dispatch. Automatic cleanup stays on hold to protect these discussions. Any future cleanup of the two baseline pairs requires an explicit owner decision on archival and deletion. This is a scoped recovery exception; the repository's existing duplicate policy remains in force for other work.

Matrix Sync sets the existing TWEET_ON_CREATE and DELETE_TWEET_ON_COMPLETE controls to false when full_resync is true, so full recovery does not replay Twitter lifecycle actions from historical issues. Manual incremental runs with full_resync=false and scheduled runs with no input automatically retain the original true behavior. This rule requires no separate restoration release and leaves the manual-only duplicate cleanup hold in force.

The sync regressions use node:test through the existing tsx dependency. The test command names the current sync regression files explicitly because the archived Jest/MSW tests require dependencies and source modules absent from this version. No additional test framework is introduced.
