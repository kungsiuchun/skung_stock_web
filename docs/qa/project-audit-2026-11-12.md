# 專案審閱與本地修補 — 2026-11-12

起點：`main` / `f195c153c8cc376f7d2374949a2f0abd21d57340`，開始時 tracked checkout 乾淨。三位獨立代理負責唯讀審閱，主代理統一修改；之後再獨立複核修補。本次沒有 commit、push、merge、遠端資源／secret／workflow 操作或 deploy。

## 已修正：11 項可重現問題

| 問題 | 原因與修補 | 主要檔案 |
| --- | --- | --- |
| Settle Up 分享連結可卡死頁面 | `1e400` 解析為 Infinity，特定分攤令結算迴圈不前進。匯入現在拒絕非安全整數、負金額、總額溢位及重複 ID；壞連結顯示錯誤。表單拒絕超限草稿並清楚說明未儲存，保留最後有效金額。 | `src/components/settle-up-page.tsx` |
| 合法 Portfolio 百分比被拒絕 | `2.30 * 100` 的浮點結果不是整數。先保留原兩位小數格式檢查，再 round 為整數 basis points。 | `src/components/portfolio-backtest-page.tsx` |
| Portfolio 可錯標供應商歷史 | 要求 VTI 卻收到 SPY 時，原本直接標成 VTI。現在缺少或不符 `meta.symbol` 一律拒絕。 | `functions/api/portfolio-backtest.ts` |
| 畸形 Portfolio 持倉誤報上游故障 | `positions:[null]` 或非字串 ticker 會拋 TypeError。共用 validator 現在先拒絕，API 回 400，零供應商呼叫。 | `src/lib/portfolio-backtest.ts` |
| SPX GEX 風控可被引用清單繞過 | 移除「CIO 沒引用 gex 就略過」分支。所有方向性輸出都受既有 canonical GEX 缺失／schema／35 分鐘限制。 | `src/lib/spx-decision-pipeline.ts` |
| NYSE 週六元旦補假錯誤 | 原本把翌年週六元旦錯算成 12/31 休市；改用 NYSE 元旦例外，保留週日元旦翌週一休市及其他節日規則。 | `src/lib/nyse-calendar.ts` |
| SPX 止蝕文字把時間當價格 | `5m close below 7515` 原本解析成 5。新進場拒絕多數值止蝕／單項目標；既有持倉的含糊止蝕沿用原有 missing-numeric-exit 安全處理。已保存的多目標分隔格式維持相容。 | `scripts/worker-spx-bot.ts` |
| Options 逾時沒有錯誤提示 | 原本把 45 秒 deadline 的 AbortError 當成使用者取消。現在 deadline 顯示明確 timeout，使用者取消及 refresh supersession 保持 AbortError。 | `src/hooks/use-watcher-workspace.ts` |
| Markets 過時資料未警告 | 同一份資料在 Today 有 STALE 警告，Markets overview 卻沒有。現在保留 freshness 型別並顯示來源日期與警告。 | `src/components/watcher-workspace-markets.tsx` |
| Caption API 可繞過上傳限制 | 伺服器現在在讀取 image array／呼叫 AI 前檢查既有 PNG/JPEG MIME、非空與 5MB 限制。這是 MIME／大小檢查，不是影像內容真偽驗證。 | `functions/api/caption.ts` |
| 失敗 dry-run 寫遠端 D1 | Robinhood publisher 的 failure diagnostic 原本忽略 `--dry-run`。現在乾跑在診斷入口也禁止遠端命令。使用假憑證及子程序 mock 回歸，沒有實際遠端寫入。 | `scripts/publish-robinhood-options-snapshot.ts` |

NYSE 例外依據：[官方 2026–2028 交易日曆](https://www.nyse.com/trade/hours-calendars)，2028 元旦註腳明列不補假；回歸涵蓋 `2027-12-31`、`2021-12-31`、週日元旦補假及其他節日。

另外同步 `CONTEXT.md` 與既有 SPX feature guide 的 GEX 規則，沒有改變宣告的產品方向。Portfolio UAT 更新為現有 Watcher workspace 標題／鍵盤導覽，保留 legacy share、錯誤、過時、並行回應及 CSV 下載驗證；可用 `PORTFOLIO_BACKTEST_UAT_PORT` 避免碰撞既有本地程序。

`package.json` 把新 caption、calendar、publisher 測試及受影響的 SPX pipeline／Worker 測試接入既有功能測試命令，現有 CI 呼叫鏈可執行這些回歸；沒有修改 workflow 定義。

## 請主人審閱的決策

### 1. SPX 價位幾何及條件式止蝕（高優先）

位置：`scripts/worker-spx-bot.ts` 的 `passesDirectionalEntryGate`、`CioModelPlan`。

目前 CALL 入場 7521、止蝕 7535、目標 7500 仍可通過入場閘門。本次已封住「把 5m 當成價格」的解析錯誤；方向幾何仍沒有明確契約。

建議決定：單純價格止蝕是否必須 CALL 在入場區下方、PUT 在入場區上方，且目標位於獲利側；條件式止蝕是否另用結構化的價格、週期與觸發方式。含糊文字目前拒絕新進場；舊持倉若止蝕無法唯一解析，會走既有 `position_missing_numeric_exit_levels` 的平倉建議路徑。這會影響訊號數量及舊計劃處理，需在發布前審閱。

### 2. Telegram 卡在 SENDING 時如何復原（高優先）

位置：`src/lib/spx-decision-ledger.ts` 的 `markDeliveryAttempt`、`listRetryableOutbox`。

程序在 Telegram 已送出、但 message_id 尚未存入 D1 的窗口終止，outbox 會留在 SENDING；現有重試只選 PENDING／FAILED。自動解鎖重送可能重複，不解鎖則可能漏訊息。

建議決定：保留人工核對，或採用逾時 lease 並明確接受至少一次傳送。沒有替主人選擇重送語義，也沒有重新發送 Telegram。

### 3. Robinhood 重試不可覆蓋已發布證據（高優先）

位置：`scripts/publish-robinhood-options-snapshot.ts` 的 `saveFailedDiagnostic`。

一般非 dry-run 失敗仍使用 `INSERT OR REPLACE`。重用一個已 published 的 runId、輸入卻缺少必要欄位時，failure diagnostic 可把該 run 改成 failed 並清除 release／manifest 欄位，current 指標則仍引用它。本次只修正 dry-run 的零寫入契約。

建議決定：失敗嘗試使用獨立 attempt ID，或只允許更新尚未發布的 run。這涉及既有紀錄及恢復政策，未執行遠端 SQL 或改寫正式紀錄。

### 4. 回測 cash 與期末再平衡的意義

位置：`src/lib/portfolio-backtest.ts` 的 `shouldRebalance`、`runBasket`。

- Monthly／quarterly／annual 在回測最後一日一定再平衡，即使最後日是 2025-02-03；現有測試明確要求此行為。它會重設最後持倉比例。
- `cash` 股息在再平衡時會重新投入股份並清空 cash；介面用語是 Hold dividends as cash。

建議決定：是否只在真正期末再平衡，以及 cash 是否在整段回測永久留現金。改動會影響方法論與歷史結果，沒有擅自改測試期待。

### 5. SPX Worker 認證遷移

位置：`scripts/worker-spx-bot.ts` 的 fetch 入口。

目前 token 放 query string，且無 WEBHOOK_SECRET 時使用 TELEGRAM_CHAT_ID 作密碼。建議盤點現有呼叫方後，遷移至獨立 secret 與 header，安排憑證輪替／相容窗口。未讀取 secret 值，未改正式設定。

### 6. Caption 正式 binding 及公開 AI 用量政策

位置：`functions/api/caption.ts`、`wrangler.toml`。

本地配置未宣告 `image_caption_ai`，此 API 亦沒有同等公開 research 的用量預算。未查正式 binding，不能斷言線上功能失效。需要主人決定是否保留公開工具、配置 binding 及預算／授權邊界；本次沒有新增資源或付費呼叫。

### 7. Yahoo transport 取消取捨

位置：`functions/api/portfolio-backtest.ts`。

API deadline 能回 504，但刻意不把 AbortSignal 傳入 Yahoo fetch，所以上游請求未必被取消。提交 `2f684776b41187f5837d08bcfab8709a5f1073a9` 及現有測試明確要求這個行為。改善前需在真實 Cloudflare Worker transport 驗證，不能只憑本地 mock 恢復 signal。

## 驗證結果與邊界

- 基線：lint、API typecheck、production build 成功；全部測試 765 項，764 成功，唯一失敗為需要真實來源的 `finance-agent-tools-smoke.test.ts`，Yahoo DNS `ENOTFOUND`。
- 修補後：全部不需真實來源的 `*.test.ts`／`*.test.mjs` 共 **770/770 通過**；沒有將真實來源 smoke 改成 skip 或偽造成功。
- `npm run lint`、`npm run typecheck:api`、`npm run build` 成功。build 仍有既存 Browserslist 資料老舊提示，沒有因此更改 lockfile。
- `npm run test:functions-bundle` 成功；Wrangler 日誌導向 `.tmp/wrangler-audit.log`，解決受限目錄的日誌權限錯誤。
- Portfolio browser UAT 成功：legacy／canonical 分享狀態、2.30% + 97.70% 的實際送出 basis points、鍵盤操作、CSV 真實下載、錯誤／過時／supersession；375／390／768／1440px，無非預期 console errors。
- Settle Up browser UAT 成功：原本會卡死的 Infinity 分享、總額溢位、重複 ID、無效金額草稿保留、確認／取消／焦點、v1/v2 分享；375／390／768／1440px。
- Markets browser 獨立驗證：375／1440px × dark／light，STALE 日期警告、11 列資料、Tab／Enter／表格焦點正常，頁面水平溢出 0、page error 0；已目視截圖。
- Options deadline 亦在真瀏覽器直接執行現有 client 並快轉 timer，驗證 timeout／caller cancel／refresh invalidation；沒有在完整 Options 元件等候真實 45 秒。
- 三位獨立代理複核；指出的測試 fixture／無效草稿測試方式／錯誤清除／重複 ID 缺口均已處理。

這是全專案重要路徑的靜態審閱、局部重現、全部離線測試及受影響介面的瀏覽器驗證，沒有宣稱逐行安全證明、全站逐頁驗收、供應商真實可用性或正式環境驗證。未部署。

本地證據（均在 git ignore 內）：`.tmp/project-audit-offline-tests.log`、`uat_screenshots/portfolio-backtest/`、`uat_screenshots/settle-up-safety/`、`uat_screenshots/project-audit-markets/validation.json`。預設 UAT port 5188 有來源未確認的 listener；沒有終止該程序，Portfolio 改用 5197。

## 修改檔案

產品／命令：`functions/api/caption.ts`、`functions/api/portfolio-backtest.ts`、`package.json`、`scripts/publish-robinhood-options-snapshot.ts`、`scripts/worker-spx-bot.ts`、`src/components/portfolio-backtest-page.tsx`、`src/components/settle-up-page.tsx`、`src/components/watcher-workspace-markets.tsx`、`src/hooks/use-watcher-workspace.ts`、`src/lib/nyse-calendar.ts`、`src/lib/portfolio-backtest.ts`、`src/lib/spx-decision-pipeline.ts`。

測試：新增 `tests/caption-api.test.ts`、`tests/nyse-calendar.test.ts`、`tests/robinhood-options-publisher.test.ts`；更新 `tests/portfolio-backtest-api.test.ts`、`tests/portfolio-backtest.uat.cjs`、`tests/settle-up-safety.uat.cjs`、`tests/spx-decision-pipeline.test.ts`、`tests/spx-worker-agent-output.test.ts`、`tests/watcher-workspace.test.ts`。

文件：`CONTEXT.md`、本報告。沒有更新長期記憶。

## 可保存的長期記憶建議

canonical GEX 不得依 CIO 引用清單略過；Robinhood `--dry-run` 包含失敗診斷也必須零遠端寫入；Yahoo fetch signal 屬已有 transport 修復的刻意約束。另可記錄上列 Telegram／published run 復原政策為未閉環事項。尚未獲授權寫入記憶。

本次使用 ponytail、senior-frontend、modern-web-guidance。accessibility 指引的「Announce dynamic errors via live regions」用於壞連結及金額錯誤提示，並將欄位錯誤以 aria-describedby 關聯；沒有引入依賴或重新設計頁面。
