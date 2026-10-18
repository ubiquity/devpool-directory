# Decisions

## 2026-10-18: Directory sync state and recovery

Persisted issue history and mirror mappings are durable state. Incremental omissions must preserve them, and only a genuine missing artifact may load as empty state. Large files use authenticated raw retrieval rather than the Contents API's inline payload. Fully paginated source fetches and existing mirror bodies recover lost identities before any creation.

A failed fetch, invalid artifact, reconciliation failure, or missing shard output fails the sync. Aggregate publication depends on every shard succeeding; a failed run must not publish a successful watermark. Scheduled and manual runs for the same branch execute serially.

During identity recovery, the duplicate cleanup job runs only through its existing manual dispatch. The normal Matrix Sync also sets the existing TWEET_ON_CREATE and DELETE_TWEET_ON_COMPLETE controls to false. These holds preserve directory issues and avoid unrelated Twitter changes while the repaired full and incremental runs are verified. Restoring automatic cleanup or Twitter actions requires a separate, reviewed decision after recovery acceptance; the repository's existing duplicate policy remains in force.

The sync regressions use node:test through the existing tsx dependency. The test command names the current sync regression files explicitly because the archived Jest/MSW tests require dependencies and source modules absent from this version. No additional test framework is introduced.
