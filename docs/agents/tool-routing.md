# Tool Routing and Local Gotchas

Read this file only when selecting external tooling, diagnosing the code graph,
or publishing through Cloudflare/GitHub.

## Preferred integrations

- Prefer an available Cloudflare connector for Workers, Pages Functions,
  Wrangler, D1, cron, and production deployment questions; otherwise use the
  existing CLI/API. Never install a connector without an explicit request.
- After meaningful UI changes, use an available browser/runtime check and verify
  the actual route, visible text, charts, and console errors.
- Prefer an available GitHub connector for PR/CI/issue work; otherwise use the
  existing GitHub tooling without expanding write authority.
- Artifact plugins are for document/spreadsheet/deck/PDF work, not repo coding.
- Do not add Figma, Notion, Gmail, Slack, Stripe, Vercel, Netlify, or Sentry
  access unless the task explicitly requires it.

## code-review-graph

- Start with repo-scoped `get_minimal_context`.
- Exploration: `semantic_search_nodes` or `query_graph`.
- Impact: `get_impact_radius` and `get_affected_flows`.
- Review: `detect_changes`, then focused `get_review_context` if needed.
- Test relationships: `query_graph` with `tests_for`.
- Fall back immediately to the least-invasive local inspection when graph tools
  are absent, fail, or do not cover the material; state the fallback once.
- `list_graph_stats` may work while the global repo registry is empty. When
  `list_repos` returns zero, use repo-scoped tools with explicit `repo_root`.
- The observed `code-review-graph.exe` shim can fail with `uv trampoline failed
  to canonicalize script path`; do not assume CLI registration works.
- Trust actual MCP schemas/output over the docs helper when advertised sections
  return `not_found`.
- Verify Python through `Get-Command python` or `Get-Command py`; do not rely on
  the removed WindowsApps path.
