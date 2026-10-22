# SPX Market Structure Board：本地改版與驗證

日期：2026-10-22。分支：`codex/spx-board-redesign`，基底 `033dc5e7f529`。
以下為首次本地 checkpoint（commit 前），不是目前 Git／部署狀態。發布前修正及新增驗證另列於文末；正式發布結果以獨立 release evidence 為準。

## 用途與設計選擇

頁面用途：在指定交易日，查看 SPX 相對 canonical 關鍵價位的位置、相對明確基準的 GEX 壓力變化，以及資料可否信任和如何查證。

評估過三種資訊架構：

| 架構 | 理解成本與時間一致性 | 實作取捨 |
| --- | --- | --- |
| 圖表先行 | 熟悉圖表者容易探索，但仍要自己拼出頁面用途及數據時間 | 改動較小，不能解決原本的優先級問題 |
| 單一時間軸 | 所有內容看似同步，卻容易把即時價格與延遲 GEX 混為一談 | 要增加跨來源同步規則，超出必要範圍 |
| **摘要先行，證據逐層展開** | 首屏先交代時間、價位、變化、品質；每個來源保留自己的時間 | 重用現有圖表，新增摘要及清楚的 evidence 入口；採用此方案 |

原有區塊的處理：

| 原有區塊 | 對應問題／處理 |
| --- | --- |
| 頁首 spot／來源 badge | 交易日、snapshot 時間、延遲與 collected 時間；delayed canonical quote 不再動畫成 live |
| HTTP／CODE／REQUEST 列 | 排查服務問題；移入 Data evidence & diagnostics |
| Compass 價格圖 | 價格結構探索；保留操作、資料來源與最後 K 線時間，標明獨立於 replay minute |
| Learning／Practice | 教學需求；按需展開，保留模式及圖形詳情 |
| Signal Monitor | 選擇圖形依據；保留排序，移除內部 idx，confidence 改成 Match n/100，註明不是勝率 |
| Pressure Matrix／Mover Tape | 壓力變化及基準；原圖保留，首屏顯示前三大 session 變化及兩端時間 |
| Exposure table／replay／cell audit | snapshot 比較及模型輸入證據；保留互動與失敗後重試 |
| Decision cockpit | 已連結 run 的證據；按需展開，CIO／Risk Gate／Telegram 語意不變 |
| Professional read／長篇 Source | 模型說明與方法；按需展開，必要品質、時間及失效警告留在正常畫面 |

## 四個核心問題的證據位置

1. **何時／甚麼狀態**：頁首 Session 列及 Snapshot SPX。歷史、15m delay、collected time、latest／pinned 分開標示。
2. **相對哪些價位**：首屏 Gamma flip 的 canonical spot 距離、call／put wall、pin。計算及價位來源沒有更換。
3. **壓力怎樣改變**：Session pressure change 顯示交易日、latest vs baseline ET、前三大 delta；完整數值在 Pressure Matrix 的 cell evidence。
4. **證據與不足**：首屏 priced／repaired／partial／unpriced／excluded；Inspect evidence 開啟診斷並移動 focus。Pressure 的不足仍由 matrix warning 說明，摘要亦會提示存在 warning。

UAT 在 1440×900 和 390×844 斷言整個 overview 底部位於首屏內，並實測 evidence 的開啟、focus 和 Enter 鍵收合。這是工程驗收，沒有冒充使用者研究。

## 程式責任與改檔

| 檔案 | 責任／改動 |
| --- | --- |
| `src/components/spx-gex-heatmap-page.tsx` | 頁面資訊層級、診斷展開、cell evidence UI；歷史 session 不重複輪詢價格 |
| `src/components/spx-board-overview.tsx` | 以已取得的 canonical 與 pressure model 呈現摘要；不增加 API 請求 |
| `src/hooks/use-spx-gex-board.ts` | 抽出載入、navigation、latest polling、播放、取消、失敗保留及重試生命週期 |
| `src/lib/spx-board-response.ts` | 共享 frontend response contract 與 runtime shape／數值驗證、使用者錯誤文字 |
| `src/components/spx-gex-pressure-matrix.tsx` | 提供現有 model 給摘要；局部故障／stale 標示與重試；診斷按需展開 |
| `src/components/spx-price-action-compass.tsx` | 取消過時日期／timeframe 請求，避免舊回應提交；學習入口、match score、價格時間與重試 |
| `src/lib/safe-json-response.ts` | 保留原錯誤資訊，增加空 body／非 JSON／壞 JSON／schema 的穩定分類 |
| `src/lib/spx-request-lane.ts` | timeout boundary 先拒絕，再 abort fetch，避免 timeout 誤判成 caller cancellation |
| `functions/api/spx-gex-heatmap.ts` | 最外層 edge 例外回傳 JSON 503、no-store，與 Pressure API 既有邊界一致 |
| `functions/api/_spx-edge-cache.ts` | optional cache acquisition 亦在 write 的 catch 範圍內；失敗留下安全的錯誤類型 |
| `functions/api/spx-price-action-compass.ts` | dated Yahoo history 排除指定 ET 日之後資料；price-overlay 限於該日 |
| `tests/spx-board-response.test.ts` | parser／identity、timeout-abort 競態、edge 例外及 cache acquisition regression |
| `tests/spx-price-action-compass.test.ts` | dated Yahoo history／overlay 的日期界線 regression |
| `tests/spx-board-redesign.uat.cjs` | 新版桌面／手機、fault injection、取消、stale、EMPTY 及恢復；輸出截圖與 JSON |
| `tests/spx-gex-playback.uat.cjs` | 更新新設計 selector；仍斷言排序、保留舊 board、live／non-live、技術診斷和原有流程 |
| `tests/capture-spx-board.cjs` | 同一 viewport／演算法的文字、SPX GET response bytes、console 與截圖採集 |
| `package.json` | 把 regression 加入既有 test:spx-gex；增加 test:spx-board:uat |
| `docs/agents/spx-decision-pipeline.md` | 同步 response／責任、時間顯示及 dated history 契約 |

現有 `spx-gex-heatmap`／`spx-gex-pressure-matrix` 純計算模組繼續負責金融計算；沒有新 framework、dependency、provider、持久化 browser cache 或 telemetry。

## 文案與請求基線

檔案保存在 repository 的 `.tmp/spx-board-redesign/`。`before.json`、`after.json` 和 `copy-audit.json` 包含逐項句子及採集數字。

- 非必要預設說明的人工分類清單：原本 **268** 個空白分詞字詞，新版替代說明 **30** 個，減少 **88.8%**。逐句 inventory 在 `copy-audit.json`；時間、數值價位、來源／延遲、fallback 與品質通知排除在此指標之外。主要做法是合併重複說明、把教學／模型解讀改成按需展開。
- 可重跑的自動長句指標：走訪預設展開的文字節點，至少 45 字元及 6 個空白分詞，排除 SVG、表格、按鈕、select、tooltip；桌面 **499 → 86**，手機 **517 → 104**。此指標包含部分必要通知，並非全部 UI 文字總量。

| 同一 July-13 GEX fixture、同一載入觀察窗口 | 改前 | 改後 |
| --- | ---: | ---: |
| SPX API response 次數（桌面／手機相同） | 7 | 4 |
| 有 body 的 response bytes 合計 | 1,589,369 | 561,886 |
| console errors | 2 | 0 |
| console warnings | 0 | 0 |
| 頁面水平 overflow | false | false |

解讀限制：改前有未帶日期 Compass 請求及實際本地 Yahoo 502；改後避免未選好日期便讀取，並停止歷史價格的初始／定時重複讀取。July fixture 超出當時 Yahoo rolling window，改後誠實回傳 empty price history；改前則錯用 October 價格。因此 payload 減少主要包含移除錯誤日期資料，**不能宣稱等價價格內容變快了多少**。GEX 151,338 bytes 與 pressure 409,093 bytes 沒有為了數字而刪欄位。

正式站的只讀基線在 `production.json`：兩個 viewport 各 6 次 response、2,229,653 bytes、0 console errors／warnings；當次沒有重現正式站 JSON 問題。這不是新版已部署的證據。

## 可重跑驗證與故障覆蓋

先啟動 `npm run dev:spx-uat`，只寫隔離的 `.wrangler/spx-uat` 本地 fixture。

| 檢查 | 結果／範圍 |
| --- | --- |
| `npm run test:spx-gex` | 101／101，包含新增 response、edge、timeout regression |
| `npm run test:spx-pa` | 38／38，包含 dated Yahoo 範圍回歸 |
| `npm run test:portfolio-ui` | 24／24，涵蓋共用 JSON parser 的既有消費端與其他原有檢查 |
| `npm run test:spx-gex-playback:uat` | PASS；原有 matrix／圖表、手機 cell audit、playback、latest／pinned、跨日、Expected Move stale／closed 等驗收保留 |
| `npm run test:spx-board:uat` | PASS；desktop／mobile 首屏、focus／keyboard、rapid dates／timeframe、保留最後有效資料、故障及手動恢復 |
| `npm run lint` | PASS，0 warnings |
| `npm run build` | PASS；有現存 Browserslist 資料庫過舊提示，沒有升級 dependency |
| `git diff --check` | PASS |

故障注入覆蓋：正常 READY、EMPTY、503 refresh 後的 last-verified 保留、HTML 502／503、空 body、截斷 malformed JSON、HTTP 200 但 schema 無效、真正的兩次 8 秒 fetch timeout、取消及快速切換。錯誤沒有產生偽造的 market values；retry 次數與 request lane 釋放均有斷言。另有既有測試覆蓋 D1 缺 binding／table／read failure 和 pressure projection 完整性。

已證實根因：

- Compass 的 in-flight boolean 會忽略新選擇；改為 effect-scoped abort 與提交前取消檢查。
- abort-aware fetch 的 AbortError 可以搶贏 timeout boundary，令 timeout 被誤分類；同步 abort rejection 的 regression 與真實瀏覽器 timeout 均驗證修復。
- Heatmap outer response clone failure 沒有 JSON 邊界；現在注入失敗會得到 no-store JSON 503。
- optional cache getter 原本在 write try 外；注入 acquisition failure 現在不會留下 unhandled rejection。
- Yahoo rolling window 不等於 requested session；現在排除未來 ET session，窗口不足保持 empty，不用新日期冒充歷史資料。

仍未證實：主人之前遇到的正式站 JSON 錯誤，究竟是哪一次 Cloudflare／D1／upstream 事件。本次沒有用未取得的正式日誌斷言其根因，也不宣稱正式站故障已修復。
最小下一步：下次真實錯誤發生時，使用診斷區保留的 request／snapshot、HTTP、分類碼及安全錯誤資訊（若有 Cloudflare Ray ID 亦一併使用）對照服務端事件；不要只憑 JSON syntax error 推斷 D1 沒有資料。

## 截圖與可檢查產物

全部位於 `.tmp/spx-board-redesign/`：

- `before-desktop.png`／`before-mobile.png`：改前同一 GEX fixture，1440×900／390×844。
- `after-desktop.png`／`after-mobile.png`：改後真實本地 API 路徑；超出價格來源日期窗口會顯示無資料。
- `verified-desktop.png`／`verified-mobile.png`：同日期、明確標示為 synthetic fixture 的正常價格圖／壓力流程；不是正式市場資料。
- `production-desktop.png`／`production-mobile.png`：正式站改前只讀基線。
- 對應 `*-full.png`、`before.json`、`after.json`、`production.json`、`copy-audit.json`、`uat.json`：採集與故障結果。頁面有內部捲動容器，browser fullPage 截圖不代表所有內部捲動內容；matrix／cell 操作由 playback UAT 另行驗證。

採集指令：`node tests/capture-spx-board.cjs after`；正式站只讀基線可用第三參數指定 origin。不得把目前程式重新截成 before 當成原版。

## 邊界、取捨與記憶建議

歷史日期超出 Yahoo 可用窗口時，價格圖會明確缺資料；這比顯示日期較新的價格正確。價格圖是獨立時間窗口，並非跟隨每個 pinned GEX minute 重新計算；UI 已明示，沒有新增跨來源交易訊號。

新 UI／驗證增加少量 client code，沒有用縮小 payload 掩蓋錯誤，也沒有調高 timeout、retry、stale ceiling 或放寬金融品質 gate。Worker、CIO、Risk Gate、Telegram、canonical 計算及 production 資料不變。既有秘密檔案沒有修改。

建議日後記憶：dated Yahoo history 的 ET 邊界；timeout boundary 必須先拒絕再觸發內部 abort；區分 request cancellation 與真實 timeout。未寫入 Obsidian 或 Codex 記憶。

## 發布前補充驗證（2026-10-22）

首次 checkpoint 後，修正了原測試漏掉的 nested schema、缺交易日、日線 UTC/ET 日期、錯誤身份、輪詢及恢復問題。真實 production heatmap 的 lifecycle ordinal 從 0 開始，shared parser 接受非負 event ordinal，model attempt 仍從 1 開始。

- GEX 108/108、Price Action 40/40、Portfolio/shared JSON 24/24；lint、TypeScript/Vite production build 及 diff check 通過。
- Playback UAT 通過，包含 CLOSED 保留、手動 overlay 恢復、tooltip、日期 rollover 和失敗 replay。
- Redesign UAT 通過桌面／手機、首屏、證據鍵盤操作、快速切換、EMPTY、HTML 502/503、空 body、壞 JSON、schema、實際 timeout 與恢復。
- 無 provider metadata 的 overlay HTML 503 實測：初始讀取＋3 次 recovery，每次最多 1 次 transport retry，共 8 次 HTTP 嘗試後停止；visibility 不會重設 budget；手動 retry 第 9 次成功，無 React error。
- 獨立 read-only agent 以真實 production payload 驗證 heatmap、pressure、歷史 1m/5m/15m/4h/1d 及 overlay；確認並回驗 lifecycle 0、盤前轉開市與 NYSE 半日收市。沒有假裝進行使用者研究。

本段是發布前驗證；commit、push、Pages/Worker 部署識別及 canonical production browser read-back 另存 release evidence，不由這份本地報告推斷上線成功。
