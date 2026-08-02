# Stock Watcher coverage-admin authentication

`POST /api/stocks-intelligence-watcher/admin` is the only endpoint that can write `coverage/universe.json` in the private `VALUATION_DATA` bucket. It is intentionally separate from the public Stock Watcher snapshot and valuation tools.

## Production setup

The owner UI uses GitHub OAuth and a signed, HttpOnly session cookie. Configure these Cloudflare Pages secrets:

- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` for the GitHub OAuth app.
- `STOCKS_WATCHER_ALLOWED_EMAIL` with the single owner email (or a comma-separated allow-list).
- `STOCKS_WATCHER_SESSION_SECRET` with a high-entropy value from a password manager.
- Optional `STOCKS_WATCHER_AUTH_ORIGIN` to pin the callback origin; otherwise the request origin is used.

Set the GitHub OAuth callback URL to `https://<watcher-origin>/api/stocks-intelligence-watcher/auth/callback`. The browser only receives the signed session cookie; it never receives a GitHub client secret or admin token.

`STOCKS_WATCHER_ADMIN_TOKEN` remains an optional server-to-server credential for trusted automation. Keep it in the caller's server-side secret store, never in React, browser storage, a URL, or a public tool drawer.

## Access boundary decision

The current canonical host is the Cloudflare Pages `pages.dev` hostname. Cloudflare Access self-hosted applications cannot be attached to that Pages hostname in this setup, so the admin route uses GitHub OAuth plus the signed owner session as the equivalent owner-only gate. This is an explicit deployment decision, not an unprotected fallback. If a custom hostname is introduced later, put Cloudflare Access in front of the site and retain the session check as defense in depth.

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

After signing in with the configured GitHub owner account, the Stock Watcher overview shows a **Coverage request** panel. Submitting a ticker calls the admin route with the HttpOnly session cookie and returns `queued`, `already_queued`, or `already_published`. A queued ticker is calculated only in the next daily ValuationCalculation batch.

The repository workflow `.github/workflows/queue-valuation-coverage.yml` remains an automation fallback. It accepts a ticker through **Actions -> Queue valuation coverage -> Run workflow** and uses the server-side `STOCKS_WATCHER_ADMIN_TOKEN` secret.
