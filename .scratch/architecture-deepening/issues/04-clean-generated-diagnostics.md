# 04 — Clean generated diagnostics without deleting evidence

**What to build:** Remove only verified, ignored, reproducible local diagnostic outputs while preserving source-controlled documentation, migrations, test coverage, and user-owned artifacts.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Audit found no item that was simultaneously ignored, untracked, inactive, and safe to remove; no cleanup was performed.
- [x] No source-controlled test, ADR, migration, formal documentation, secret-bearing configuration, or unverified historical evidence was removed.
