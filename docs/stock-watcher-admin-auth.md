# Stock Watcher coverage-admin authentication

`POST /api/stocks-intelligence-watcher/admin` is the only endpoint that can write `coverage/universe.json` in the private `VALUATION_DATA` bucket. It is intentionally separate from the public Stock Watcher snapshot and valuation tools.

## Production setup

1. Generate a high-entropy value in a password manager.
2. Set it as the Cloudflare Pages secret `STOCKS_WATCHER_ADMIN_TOKEN` for the `sius-ai-workshop` project.
3. Keep it in the trusted caller's server-side secret store. Do not put it in React, browser storage, a URL, or a public tool drawer.

The route fails closed: an unset secret returns `503 ADMIN_AUTH_UNCONFIGURED`; missing or invalid credentials return `401 ADMIN_AUTH_REQUIRED`.

## Trusted caller contract

```http
POST /api/stocks-intelligence-watcher/admin
Authorization: Bearer <STOCKS_WATCHER_ADMIN_TOKEN>
Content-Type: application/json

{"tool":"request_valuation_coverage","params":{"symbol":"IBM"}}
```

The response is `queued`, `already_queued`, or `already_published`. A queued ticker is calculated only in the next daily ValuationCalculation batch.

## Owner workflow

The repository workflow `.github/workflows/queue-valuation-coverage.yml` accepts a ticker through **Actions -> Queue valuation coverage -> Run workflow**. Configure the same value as the repository Actions secret `STOCKS_WATCHER_ADMIN_TOKEN`; GitHub then calls the Pages admin route without exposing it to the browser.
