# Finance Analyzer DeepEar Removal And Trader-Grade Source Upgrade Design

日期：2026-06-30
狀態：已獲主人批准設計方向 B，等待 spec review 後實作

## 結論

Finance Analyzer 應採用「Finance Analyzer full removal」方案：DeepEar 從 Finance Analyzer 的 dashboard prompt、dashboard tool allowlist、frontend state/parsing、dashboard UI、source map、Finance chat tool 說明全部移除，但暫時不做 repo-wide 工具刪除。

原因很簡單：只刪 UI 會留下隱性 endpoint call；repo-wide 刪除又可能破壞其他 agent surface。B 是最小但真乾淨的切法。

## 現況問題

- `src/components/finance-dashboard.tsx` import 並渲染 `DeepEarSignalsCard`。
- dashboard prompt 明確要求 `get_financial_signals` 取得 DeepEar 訊號。
- frontend 仍解析 `get_financial_signals` 結果，存入 `financialSignals`。
- dashboard 有兩處 DeepEar UI：左欄 `AI DeepEar Signals` 和右欄 `DeepEar 高頻預警` card。
- `src/lib/finance-analyzer-contract.ts` 的 dashboard tool list 仍包含 `get_financial_signals`。
- `functions/api/agent/chat.ts` dashboard allowlist 仍允許 `get_financial_signals`。
- `functions/api/agent/executor.ts` chat prompt 仍把 DeepEar 描述成可用工具。

## 專業交易者評估

現有 dashboard 有 price/chart/options/news/VIX/fundamentals/technical radar/AI narrative，適合快速 retail-style scan，但未夠 professional trader 用。

缺口：

- Event risk 不夠：缺少 SEC filings、earnings/corporate action 類可追溯事件層。
- Liquidity/range risk 不夠：缺少 dollar volume、relative volume、ATR、gap/range risk。
- Regime context 不夠：VIX 有了，但缺少 SPY/QQQ/IWM relative strength 和 rates/macro context。
- Source labeling 要更硬：Yahoo Finance 可用，但不是交易所官方 source；UI 要標示「市場資料來源」和「本地計算」。

## 免費 Source-Of-Truth 原則

第一輪改進只用現有免費資料與本地計算：

- Yahoo Finance chart/quote/options：延續現有 endpoint，用於價格、K 線、成交量、options chain。
- 本地計算：relative volume、dollar volume、ATR、range risk、gap risk、benchmark relative strength。
- SEC EDGAR official APIs：第二輪 event-risk candidate，不需要 paid vendor。
- FRED 或 Treasury FiscalData：第二輪 macro/rates candidate；FRED free key 需要配置，Treasury FiscalData 無需 key。

不加入：

- paid market data vendor。
- 假 real-time OPRA/order book。
- 來源不清的高頻訊號。
- 會增加 OpenRouter model call 的新 AI agent council 預設流程。

## Scope

### 必做

1. 移除 Finance Analyzer dashboard 對 DeepEar 的所有 runtime dependency。
2. 移除 dashboard visible text 裏的 `DeepEar`、`高頻`、`get_financial_signals`。
3. 從 dashboard tool allowlist 和 source map 移除 `get_financial_signals`。
4. 清理 frontend `DashboardData.financialSignals` 及相關 parsing/rendering。
5. Finance chat prompt 不再主動宣傳 DeepEar。
6. 用本地計算補一個 trader utility card，優先顯示 liquidity/range risk。

### 不做

- 不刪 `functions/api/agent/tools/alphaear-tools.ts` 裏的 tool handler，除非後續 impact check 證明沒有其他 surface 使用。
- 不改 SPX GEX heatmap、Trading Agent Committee、Watcher。
- 不部署，除非主人之後明確要求 `deploy pls`。
- 不加入 paid API、登入、secret 或 production data dependency。

## Proposed UI Change

移除右欄 `DeepEar 高頻預警` card 後，補一張 `交易風險快照`：

- Dollar volume：`close * volume`，用億/萬/K 格式。
- Relative volume：最近一日 volume / 20 日平均 volume。
- ATR range：用最近 OHLC 計算 14 日 ATR。
- Range position：當前價格在最近 20 日 high-low 區間的位置。
- Benchmark check：如可在現有免費行情取得 SPY/QQQ/IWM，顯示相對強弱；否則明確顯示「Needs data」。

這張卡是 deterministic，來源是 Yahoo chart data + local calculation。AI 只能解讀，不負責製造數字。

## Data Flow

1. Dashboard submit ticker。
2. `/api/agent/chat` dashboard surface 只允許 quote、options、strategy。
3. parallel fetch 保持 `/api/news`、`/api/vix`、`/api/fundamentals`、`/api/technical-radar`、`/api/sentiment`。
4. frontend 從 chartData 計算 trader risk snapshot。
5. AI finalAnalysis 只整合已抓取資料；缺資料要標示，不可補洞。

## Verification

本地驗證：

```powershell
npm run build
```

Browser smoke：

- 開 Finance Analyzer。
- 分析 `AAPL` 或 `TSLA`。
- 確認畫面不再出現 `DeepEar`、`高頻`、`get_financial_signals`。
- 確認 console 無 runtime error。
- 確認 trader utility card 顯示 deterministic 數字或清楚的 `Needs data`。

Code checks：

```powershell
Select-String -Path '.\src\**\*','.\functions\**\*' -Pattern 'DeepEar|高頻|deepear|get_financial_signals' -CaseSensitive:$false
```

可接受結果：Finance Analyzer 路徑不應再出現；非 Finance Analyzer tool implementation 若仍存在，需在 final 裏明確說明保留原因。

## Counter-Risks

- Yahoo Finance 不是官方 exchange source；不能把它包裝成 institutional real-time feed。
- SEC/FRED/Treasury 加入後會增加 endpoint 和 loading/error state；第一輪不硬塞。
- 太多卡片會降低 trader 掃描效率；第一輪只補一張高信號 deterministic risk card。
- 清理 prompt 但忘記 allowlist 會繼續打 DeepEar；必須一起改。

## Paste-Ready Goal Contract

```text
/goal 在 skung_stock_web 的 Finance Analyzer 中完整移除 DeepEar 高頻訊號依賴，並用免費、可追溯資料或本地計算補一個 professional trader 更有用的 deterministic 風險快照；保留其他 agent surface 的既有工具，除非 impact check 證明安全可刪。
Verification: 先用 code-review-graph 或 repo search 確認 DeepEar/get_financial_signals 的影響範圍；修改後執行 npm run build；用 browser smoke 打開 Finance Analyzer 並分析 AAPL 或 TSLA；確認畫面和 Finance Analyzer runtime 不再出現 DeepEar/高頻/get_financial_signals，console 無錯，新增風險快照只顯示 Yahoo chart data、本地計算或明確 Needs data。
Constraints: 不加入 paid API、登入、secret、production data dependency、假 real-time OPRA/order book 或新的預設 LLM council；不改 SPX GEX、Watcher、Trading Agent Committee 或 unrelated dashboard。
Boundaries: 主要修改 src/components/finance-dashboard.tsx、src/lib/finance-analyzer-contract.ts、functions/api/agent/chat.ts、functions/api/agent/executor.ts，以及必要的新 deterministic utility/card/test；不要碰部署設定或 secret 檔。
Iteration policy: 先移除 DeepEar runtime path，再加入一個小而可驗證的 deterministic trader utility card；每次有意義修改後重跑 build 或 targeted check；同一錯誤連續失敗 2 次後改用新的日誌、搜尋或 browser evidence。
Stop when: build 通過，browser smoke 證明 Finance Analyzer 無 DeepEar 殘留且新卡資料來源清楚，final 回覆列出寫入檔案、build 結果、未部署狀態和 remaining risks。
Pause if: 需要 paid/vendor market data、外部 API key、production deploy、破壞性 git 操作、或需要主人決定是否 repo-wide 刪除 AlphaEar tool 時暫停。
```
