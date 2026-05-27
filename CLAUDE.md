<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

### Local Tooling Gotchas

- `list_graph_stats` can succeed even when `list_repos` and `cross_repo_search` return zero results. This means the repo-local graph database exists at `.code-review-graph/graph.db`, but the global multi-repo registry is empty.
- Before using `cross_repo_search`, run `list_repos`. If it returns `0 registered repository(ies)`, use repo-scoped graph tools with an explicit `repo_root` instead of cross-repo search.
- Current observed broken CLI shim: `C:\Users\kungs\.local\bin\code-review-graph.exe` returned `uv trampoline failed to canonicalize script path` when called with `--help` or `register --help`. Do not assume the CLI `register` path works until that shim is reinstalled or repaired.
- The MCP docs helper advertised sections such as `usage`, `commands`, and `troubleshooting`, but returned `not_found` for those same names in this environment. Trust actual MCP tool schemas and direct tool output first.
- The previously documented Python path `C:\Users\kungs\AppData\Local\Microsoft\WindowsApps\python.exe` was observed missing. Verify Python with `Get-Command python` / `Get-Command py` before relying on a hard-coded interpreter path.
