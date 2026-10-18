# DevPool Directory — Data Branch (__STORAGE__)

This branch is an artifacts-only branch for UIs and services. Files are updated atomically per run.

How to fetch (Contents API):
- GET /repos/{owner}/{repo}/contents/{path}?ref=__STORAGE__
- Use ETag/If-None-Match to avoid re-downloading unchanged files.
- Poll summary.json first; if unchanged, skip other reads.

Primary artifacts:
- partner-open-issues.json — Open + priced partner issues (Price: label).
- partner-open-proposals.json — Open partner issues without Price: ("proposals").
- mirror-state.json — node_id -> mirror linkage + assignment flags.
- index.json — node_id -> { number, url } for directory issues.
- statistics.json — Aggregate counts + lifetime rollups.
- owners-avatars.json — { owner, type, avatar_url }[] for badges.
- partner-pull-requests.json — Partner PRs (state=all).
- twitter-map.json — node_id -> tweetId.
- twitter-pending.json — Fresh lifecycle candidates retained until Twitter succeeds.
- issues-map.json — Persistent map of all known issues (state=all). Large.
- lifetime-map.json — node_id -> closed priced amount (for totals).
- sync-metadata.json — Per-repo since/etag hints.
- summary.json — Run summary and list of committed files.

Notes:
- Price label standard is "Price:" only. The legacy "Pricing:" prefix is deprecated and treated as unpriced.
- Array order is not guaranteed; sort client-side as needed.
- Identity key is GitHub GraphQL node_id.
