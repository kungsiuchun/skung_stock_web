# Stocks Intelligence Token Rotation

The SPX GEX heatmap Worker and the Stocks Intelligence Watcher Pages Function use the Cloudflare secret `MCP_BEARER_TOKEN` to call the Stocks Intelligence MCP SSE server. The token value comes from the local Stocks Intelligence session file and can expire after roughly 7 days.

## Alert

The Worker sends a Telegram message when the heatmap generation fails with a Stocks MCP `401` or `403` auth error:

```text
[SPX GEX Heatmap token expired]
Stocks Intelligence MCP rejected the Worker token.
Action: sign in via the VS Code extension, then run npm run spx:gex:rotate-token.
```

That alert means the Cloudflare secret is stale. It does not mean D1, retention, the heatmap card, or the Stocks Intelligence Watcher UI is broken.

## Rotate

1. Sign in again through the Stocks Intelligence VS Code extension.
2. Run:

```powershell
npm run spx:gex:rotate-token
```

The script reads `~\.stock-intelligence\session.json`, validates the token against the MCP SSE endpoint, then updates Cloudflare secret `MCP_BEARER_TOKEN` in two places:

- the SPX Worker, using `wrangler.spx.toml`
- the Pages project `sius-ai-workshop`, for `/api/stocks-intelligence-watcher`

The script must not print the token. Do not paste the token into chat, logs, docs, or memory.

## Smoke Test

Trigger a forced heatmap run through the protected Worker URL:

```powershell
Invoke-WebRequest "https://spx-trading-pua.kungsiuchun0.workers.dev/?gex&force&token=<WEBHOOK_SECRET_OR_TELEGRAM_CHAT_ID>" | Select-Object -ExpandProperty Content
```

Then check D1:

```powershell
npx wrangler d1 execute spx-recap-db --remote --command "SELECT date, generated_at, spot, json_array_length(expiries_json) AS expiries, json_array_length(cells_json) AS cells FROM spx_gex_heatmaps ORDER BY date DESC LIMIT 3;"
```

Open the Work Gallery heatmap card or the direct heatmap route and confirm the newest date is selectable.
