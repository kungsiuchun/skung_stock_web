# Project Agent Instructions

Keep this root file limited to repository-wide rules. Feature contracts live in
`docs/agents/`; load only the guide relevant to the files being changed.

## Execution rules

- Move quickly through tight scope, but never trade validation or explicit
  commit, push, merge, resource-creation, secret, workflow, or deploy authority
  for speed. Treat every gate separately.
- Fail fast. Do not hide errors with synthetic fallbacks or claim success without
  first-hand evidence.
- Fix a confirmed root cause. When evidence is incomplete, run bounded checks and
  state the known, unknown, and smallest safe next step.
- Add only the minimum observability needed to locate an otherwise unprovable
  failure. Third-party telemetry, retention, and personal-data collection need
  explicit authorization.
- Preserve traceability on changed critical paths. Update declared architecture,
  deployment, public contracts, security boundaries, or product direction when
  they genuinely change; do not document ordinary implementation detail here.
- Preserve unrelated dirty files and user-owned state.

## Project and commands

SIU'S Portfolio is React + TypeScript + Vite + TailwindCSS with Cloudflare Pages
Functions. Finance data includes Yahoo, EastMoney, R2, and D1-backed features.

```powershell
npm run dev:all
npm run build
npm run deploy
```

- `npm run build` is the required production build.
- `npm run deploy` is the required paired production deploy command, but run it
  only when deployment is explicitly authorized.
- Use the feature-specific `test:*` scripts listed in `package.json`.
- Never use Linux shell commands through the command runner. Use PowerShell
  `Get-ChildItem`, `Get-Content`, and `Select-String`.
- Verify Python through `Get-Command python` or `Get-Command py`.

## Code graph and external tools

- Start code exploration/review with repo-scoped code-review-graph tools when
  available: `get_minimal_context`, then the smallest matching query.
- Fall back immediately to local read-only inspection when the graph is absent,
  fails, or lacks coverage; state the fallback once.
- Read `docs/agents/tool-routing.md` only for detailed graph troubleshooting,
  plugin selection, Cloudflare, browser, or GitHub integration work.

## Context routing

Before changing a feature, read only its matching guide:

- Finance Analyzer UI/agent: `docs/agents/finance-dashboard.md`
- Shared D1 market cache: `docs/agents/market-data-cache.md`
- S&P 500 market breadth: `docs/agents/market-breadth.md`
- Watcher valuation publication: `docs/agents/watcher-valuation.md`
- SPX decision/GEX/Worker/Telegram: `docs/agents/spx-decision-pipeline.md`
- Domain trackers: `docs/agents/domain.md`
- Issue publication: `docs/agents/issue-tracker.md`

Read `CONTEXT.md` only for portfolio navigation, Work Gallery, public
positioning, or repository-level product direction. Do not preload all feature
guides for a small task.

## Git worktree lifecycle

- Normal fixes use the current checkout. Use a worktree only for dirty-checkout
  isolation, genuinely independent parallel work, or a high-risk release; state
  the reason first.
- A worktree never authorizes commit, push, merge, or deploy.
- After an authorized lifecycle, remove only a clean merged worktree, delete only
  its merged branch, and run `git worktree prune --expire now`.
- Never force-remove a dirty/unclear worktree or discard user-owned state. Report
  its exact path, branch, and status.

## Obsidian Codex memory

Long-term project memory lives at
`skung_stock_web_obsidian_vault/Codex記憶`. Before a significant task, skim its
`AGENTS.md`. Suggest concise, durable memory updates at closeout, but write only
with explicit user authorization. Never store secrets, credentials, cookies,
tokens, private contact data, raw logs, or full chat transcripts.
