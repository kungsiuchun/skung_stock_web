# 01 — Restore trustworthy code-review graph evidence

**What to build:** Restore a repository-local graph that shows real module communities, execution flows, dependency impact, and test relationships, so architecture decisions and future refactors are traceable rather than inferred from stale graph output.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Architecture overview reports non-empty communities when source relationships exist, or a reproducible source-level reason why it cannot.
- [x] A representative hot path returns consistent impact, flow, and test relationship evidence.
