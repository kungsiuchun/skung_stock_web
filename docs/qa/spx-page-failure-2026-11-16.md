# SPX 頁面失效：2026-11-16

## 已確認根因

正式頁面可重現截圖狀態。`GET /api/spx-gex-heatmap` 回 200/READY，但 browser contract validator 拒絕 `collectionAttempts[0].quality`，拋出 SCHEMA_INVALID，整份 snapshot 無法寫入頁面 state。依賴 selected session 的價格及 Pressure 載入因而無法繼續。

該 quality 實際只有四項：pricedCellCount=18、repairedCellCount=0、partialCellCount=1、unpricedCellCount=461。Canonical NORMALIZED producer 明確允許只有這四個 cell 計數（provider diagnostics helper 是 optional），前端卻要求 rawLegCount 等全部 provider 計數、sourceTimestamp 與 cacheStatus。

另一根因是 lifecycle attempt aggregator 用後續 quality 物件整份覆蓋先前值，可能丟失較早 FETCHED event 的來源診斷。

## 本地修正

- `src/lib/spx-gex-collection-lifecycle.ts`：明確定義 cell-only quality 契約，provider diagnostics 可缺失；依事件合併 quality，保留先前來源欄位。
- `src/lib/spx-board-response.ts`：四個 cell 計數仍必須有效；來源診斷存在時嚴格驗證，缺失時保留未知，不補零、不關閉 schema validation。
- `tests/spx-board-response.test.ts`、`tests/spx-gex-collection-lifecycle.test.ts`：涵蓋實際四欄格式、非法值仍被拒絕，以及後續 cell quality 不得清掉來源診斷。

## 驗證與發布界線

以下為修補部署前的診斷紀錄；正式發布結果見文末。

- 正式 GEX、Pressure、價格 API 均回 200，GEX/Pressure 為 READY；讀取約0.5–0.8秒。
- 正式瀏覽器重現 Snapshot unavailable；沒有 console/page error，只有 heatmap API request，證明卡在 response ingestion。
- 捕捉的正式 payload 在修正前確實被拒絕，修正後驗證成功。
- 本地瀏覽器使用真實正式 GET 回應：snapshot 正常、價格圖61根 candles、Pressure 21列；page errors=0，沒有 Snapshot unavailable 或 Loading Pressure 狀態。
- 17/17 targeted tests 通過，`npm run build` 通過；僅既存 Browserslist 資料老舊提示。
- 沒有 commit、push 或 deploy；正式頁面尚未修復。現有 branch 同時包含尚未發布的其他 hardening 修改，不應把整個 checkout 當成單一 SPX 緊急修補直接部署。

暫存證據：`.tmp/live-spx-diagnosis.json`、`.tmp/live-spx-payload.json`、`.tmp/fixed-spx-diagnosis.json`、`.tmp/fixed-spx-page.png`。沒有修改正式資料或呼叫模型。

記憶建議：canonical collection quality 可只有 cell counters；provider diagnostics 缺失不可填零，aggregator 應合併同 attempt 的分階段 evidence。未寫入長期記憶。

## 正式發布完成

- 只將四個 SPX 修補／回歸測試檔案隔離發布，排除同檔尚未完成的 Telegram UNKNOWN/EXPIRED 修改及其他 hardening。
- commit `ce48180585b38257e4eed6e6aeabca6787cdb62d` 已 fast-forward 合併並推送 `origin/main`。
- 隔離 checkout：766/766 離線測試、lint、API typecheck、production build、Functions bundle及使用真實API資料的browser驗證通過。
- [GitHub Quality Gate](https://github.com/kungsiuchun/skung_stock_web/actions/runs/43941763659) 成功。
- 執行 `npm run deploy`，Pages production deployment `5b5ad4c5-df59-4c50-8a17-6927b7d8df05`，正式 metadata 確認 branch=main、commit=ce48180585b38257e4eed6e6aeabca6787cdb62d。
- 配對 SPX Worker version `4ac37ceb-e10f-41f7-a4cd-1e2a579ce094`；沒有同步、建立或輪替 secret，沒有套用其他 hardening migration。
- 正式頁面於 2026-11-16 11:43 PST（19:43 UTC）驗證：snapshot正常、價格圖62根candles、Pressure Matrix21列，SPX GET全數200，console/page errors=0。
- 原本 `codex/project-hardening-decisions` 的未完成修改保留，本次沒有將它們發布。
