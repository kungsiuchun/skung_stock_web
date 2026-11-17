# Hardening 本地收尾 — 2026-11-16

本輪按主人指示修正開盤重試，並完成先前保留在 `codex/project-hardening-decisions` 的修改與整合驗證。正式環境仍是先前獨立發布的 `ce48180`；本輪沒有 commit、push、merge、部署、遠端 migration、secret/binding 更新、模型或 Telegram 呼叫，也沒有改寫開盤歷史資料。

## 開盤根因及修正

正式 2026-11-16 的開盤 slot 在 09:45:03 ET 記錄 `GEX_COLLECTION_FAILED`，09:45:08 取得 Yahoo fallback，09:45:11 存入資料。480 格中 priced=18、partial=1、unpriced=461；0DTE 開盤基準僅 9 個 strike，當時畫面內 7375–7475 的 21 個 strike 全無基準。沒有 09:47/09:50 的定時重試事件。

原成功契約只要求任一 expiry 有一個 audited blended-IV cell；只有零合格格子的特定錯誤才會啟動開盤重試。另發現同一條 lifecycle 的 FETCHED 自動配置 attempt=2，NORMALIZED/PERSISTED 卻被呼叫端傳入的 attempt=1 蓋回去。

- `src/lib/spx-gex-heatmap.ts`：所有共用 generation 入口在開盤持久化前檢查同交易日 0DTE。以 SPX 四捨五入至 5 點後的 +/-150 點視窗，61 個 strike 至少 49 個 audited cells 才接受；不同 expiry、重複 strike、視窗外資料不增加覆蓋率，真實零 GEX 可以計數。拒絕資料保留 NORMALIZED 的品質與覆蓋 evidence，不能先存成可用基準。重用既有開盤快照亦必須通過同一檢查。
- `src/lib/spx-market-scheduler.ts`、`scripts/worker-spx-bot.ts`：不足覆蓋、零合格 cells、來源錯誤、逾時可進入既有 09:47／09:50 ET fresh CBOE-only 重試；總共最多三次。D1／預算與 malformed-contract 錯誤不重試。超過兩分鐘寬限的舊 retry alarm 跳過，不拿較後資料補造舊開盤，不重播 Council/CIO 決策。
- `src/lib/spx-operational-health.ts`：先辨識 D1 和 timeout，再辨識 GEX；避免含 `spx_gex` 表名的 SQL 錯誤被誤判為可重試來源故障。
- `src/lib/spx-gex-collection-lifecycle.ts`：保留已配置的較高 attempt，修正 recovered collection 的完整階段編號。
- `src/components/spx-gex-pressure-matrix.tsx`：有 `NO_BASELINE` 的可見列會顯示數量與原因，明示空格不是零變化。仍維持缺資料不填色，Current GEX 和價格線獨立。

門檻是收集品質政策，不保證供應商成功；49/61 仍容許最多 12 個缺口，價格移到視窗外亦不能憑空產生基準。今天已保存的資料沒有被覆寫，沒有以零值或新資料修補歷史。

## 先前修改的收尾

| 範圍 | 完成的本地行為 | 主要檔案 |
| --- | --- | --- |
| Portfolio v2 | cash 股息全程保留現金；只在真正 NYSE 期末再平衡投資持倉；v1 分享保留輸入但需明確遷移；API、回應、CSV 標示 v2 和 cash；百分比浮點與 Yahoo symbol/input validation 修補保留。 | `src/lib/portfolio-backtest.ts`、`portfolio-backtest-share.ts`、`portfolio-backtest-csv.ts`、`src/components/portfolio-backtest-page.tsx`、`functions/api/portfolio-backtest.ts` |
| SPX execution | 結構化 entry/stop/target、CALL/PUT 價格幾何、touch 或已完成 5m/15m bar-close；舊的不可驗證規則顯示人工處理，不猜價格。 | `src/lib/spx-execution-plan.ts`、`scripts/worker-spx-bot.ts`、`scripts/prompts.ts` |
| Telegram recovery | UNKNOWN／EXPIRED、20 秒 send deadline、60 秒 lease、attempt fencing；未知收據不自動重送；人工 POST 重試需承認重複風險，超過 15 分鐘／被新決策取代則過期。 | `src/lib/spx-decision-pipeline.ts`、`spx-decision-ledger.ts`、`spx-board-response.ts`、`migrations/0017_spx_delivery_recovery.sql` |
| Worker auth | 獨立 Bearer secret；拒絕 query token／chat-ID fallback；沒有 secret 時先回 503，不能進入副作用。 | `src/lib/spx-worker-auth.ts`、`scripts/worker-spx-bot.ts` |
| Robinhood evidence | dry-run 包括失敗診斷都零遠端寫入；原子 run/release claim；已發布相同重試只核對 immutable objects，不移動 current；失敗診斷不能蓋掉 published evidence。未取得 claim 的 running/failed run 不會自動搶回。 | `scripts/publish-robinhood-options-snapshot.ts` |
| Caption owner | allowlisted owner + same-origin POST、MIME/空檔/5MB 限制、缺 AI binding 明確不可用；cookie 改 `/api`，callback 清舊 scope，logout 清兩種 scope；訪客／availability check 不呼叫 AI。 | `functions/api/caption.ts`、`src/components/ai-caption-tool.tsx`、Watcher auth `callback.ts`／`logout.ts` |
| 其他原審閱修補 | Settle Up Infinity／總額溢位／重複 ID、錯誤草稿；NYSE 元旦例外；Options timeout/cancel/supersession；Markets stale 警告；所有方向性決策的 canonical GEX gate。 | `src/components/settle-up-page.tsx`、`watcher-workspace-markets.tsx`、`src/hooks/use-watcher-workspace.ts`、`src/lib/nyse-calendar.ts`、`spx-decision-pipeline.ts` |

本輪額外發現原 `typecheck:api` 沒有包含 Worker／publisher。修正 publisher assertion function 宣告及 Worker nullable contracts，沒有加入假數值；`tsconfig.api.json` 現在永久覆蓋這兩個腳本。`package.json` 將 recovery/auth/scheduler/lifecycle/health 測試接入現有 `test:spx-gex`，CI workflow 本身沒有修改。

`CONTEXT.md` 同步 Portfolio v2 方法論；`docs/agents/spx-decision-pipeline.md`、`watcher-workspace.md` 同步公開契約、重試和安全邊界，沒有把 implementation detail 加進 root AGENTS。

## 本輪第一手驗證

- 全部 `.test.ts`／`.test.mjs` 離線測試：**798 passed / 0 failed / 0 skipped**。獨立的 credentialed/live-provider `finance-agent-tools-smoke.test.ts` 不在離線 gate，沒有假稱供應商可用性驗證。
- `npm run typecheck:api`：通過，包含 Worker/publisher 的 strict typecheck。
- `npm run lint`：通過，zero warnings。
- `npm run build`：通過；只有既存 caniuse-lite 資料老舊提示，未改 lockfile。
- `npm run test:functions-bundle`：通過。
- `wrangler deploy --dry-run --config wrangler.spx.toml`：Worker bundle 通過，沒有部署。
- 18 個 migration 全部依序在記憶體 SQLite 套用成功；integrity=ok、foreign_key_check=0。另有 migration 0017 保留 delivered message ID、health view 與 attempt fencing 的回歸。
- Portfolio UAT：v1/v2、實際 CSV 下載、basis points、錯誤／並行回應／鍵盤及 375/390/768/1440px 通過。
- Caption UAT：owner／visitor／unconfigured、檔案限制、取消、晚回應、modal 焦點與多個 viewport 通過。
- Cookie 真瀏覽器整合：本地真 handler + 假 GitHub provider；舊 scope 清除、唯一新 cookie Path=/api；Caption GET 登入 200、登出 401，AI calls=0。
- Settle Up UAT：Infinity、溢位／無效草稿、分享、確認／取消與 375/390/768/1440px 通過。
- Markets UAT：375/1440px、dark/light、stale 日期、11 列、keyboard table focus、overflow=0、page errors=0。
- Options client：真瀏覽器快轉 deadline；逾時顯示 Error，caller cancel／invalidate 保持 AbortError；沒有等真實 45 秒或聲稱完整 Options 頁端到端驗證。
- Pressure UAT：正式資料的唯讀保留樣本顯示 21/21 缺基準警告；明確的本地合格 fixture 正常顯示綠/紅色。375/1440px、overflow=0、page errors=0、格子 Tab focus 可見，已目視截圖。
- senior-frontend 原 checker 缺 Playwright；以專案既有 Puppeteer 執行其 `auditDom`／`focusStop`，沒有加依賴。全頁 DOM heuristic 回報六個既有 SVG chart signal rect/text，Signal Monitor 已有相同訊號的原生 button；這不是全站 WCAG／screen-reader 證明。

主要證據（git-ignored）：`.tmp/hardening-completion-tests.log`、`completion-typecheck-api.log`、`completion-lint.log`、`completion-build.log`、`completion-functions.log`、`completion-worker-bundle.log`、`completion-*-uat.log`；`uat_screenshots/hardening-completion/`、`portfolio-backtest/`、`caption/`、`settle-up-safety/`、`project-audit-markets/`。

## 正式環境與發布界線

本輪只讀 Cloudflare 設定確認：Pages owner allowlist 與 session secret 已存在；`image_caption_ai` binding 未存在；Worker `WEBHOOK_SECRET` 未存在。沒有讀出／寫入 credential 值。

- 尚未套用遠端 migration 0017；新 outbox 狀態必須先有相容 schema 才能正式執行。
- Worker 獨立 secret 未配置時，新的手動管理入口會 fail closed；排程 alarm 不使用該入口。
- Caption binding 未配置時，新的 owner UI 會明示不可用，不能宣稱 AI generation 已恢復。
- 新 secret／binding 涉及額外正式設定與 AI 服務使用，需明確授權；本地程式完成不等於已發布或正式功能全部可用。
- 既有正式開盤資料及 append-only lifecycle evidence 未被修訂。

## 記憶 closeout 建議（未寫入記憶）

建議記錄開盤 49/61 覆蓋門檻、09:47/09:50 有界重試及不可回填歷史，以及 Worker/publisher 已納入 strict API typecheck；並把 secret/binding／0017 正式啟用列為未閉環事項。

## Wrap-up 發布準備

主人隨後指示「wrap it up」，本輪授權接續完成 migration、兩項正式設定及 commit/merge/deploy；前文「未發布」描述的是本地驗證階段，最終結果以發布 closeout 為準。

- 依 [Cloudflare 官方停用公告](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/)，LLaVA 計劃於 2026-11-20 停用，因此 Caption 改用官方建議的 [Moondream 3.1](https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/)。沿用短 caption 提示，base64 data URI、query task、reasoning=false、stream=false、max_tokens=50；只接受非空 answer，沒有舊模型 fallback。100KB 圖片編碼和畸形輸出新增回歸。
- `wrangler.toml` 宣告 `image_caption_ai` binding，避免正式配置與本地來源脫節。
- Worker 新 secret 只經 stdin/API 傳送；本地備份使用 Windows DPAPI，置於 git-ignored `.local-secrets/`，不改既有 `.dev.vars`，不輸出 secret。
- 正式 migration 前後比對 outbox 整體內容雜湊與列數；不觸發 Telegram 重送或歷史市場資料重收。
