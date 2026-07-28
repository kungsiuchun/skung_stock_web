# 03 — Deepen Dashboard Snapshot State

**What to build:** Give the Finance Dashboard one state interface that owns snapshot loading, cancellation, persistence, history selection, and error/stale transitions, while the view remains a rendering adapter for that state.

**Blocked by:** 01 — Restore trustworthy code-review graph evidence.

**Status:** done

- [x] State transitions for fresh, loading, failed, persisted, and selected-history data are testable without rendering the full dashboard; cache metadata preserves stale status from the snapshot API.
- [x] Existing dashboard behavior remains visible through the same user workflow; relevant tests, browser smoke, and build pass.
