# 02 — Deepen the SPX Decision Run module

**What to build:** Give each scheduled or manually previewed SPX decision run one focused orchestration interface that assembles its market snapshot, invokes the existing governance core, records lifecycle/outbox evidence, and delivers through its adapter without changing decision authority or fail-closed behavior.

**Blocked by:** 01 — Restore trustworthy code-review graph evidence.

**Status:** done

- [x] The HTTP/cron entry adapters delegate to one traceable Decision Run interface while Council, CIO, and Risk Gate authority remains unchanged.
- [x] Fixture-backed tests prove lifecycle persistence, degraded HOLD behavior, and delivery boundaries; targeted regression tests and build pass.
