# Finance Analyzer DeepEar Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove DeepEar from Finance Analyzer runtime and UI, then add one deterministic trader risk snapshot sourced from existing free market data and local calculations.

**Architecture:** Keep the change scoped to Finance Analyzer. Backend dashboard tool registration will stop exposing `get_financial_signals`; frontend dashboard state will stop parsing/rendering DeepEar; a small local utility will derive risk metrics from chart OHLCV data. Other agent surfaces keep the AlphaEar tool implementation unless later impact analysis proves it is safe to delete.

**Tech Stack:** React, TypeScript, Vite, Cloudflare Pages Functions, existing Yahoo-backed chart data, local deterministic calculations.

---

### Task 1: Remove Finance Analyzer DeepEar Runtime Path

**Files:**
- Modify: `functions/api/agent/chat.ts`
- Modify: `functions/api/agent/executor.ts`
- Modify: `src/lib/finance-analyzer-contract.ts`
- Modify: `src/components/finance-dashboard.tsx`
- Leave unchanged: `functions/api/agent/tools/alphaear-tools.ts`

- [ ] **Step 1: Remove dashboard allowlist access**

In `functions/api/agent/chat.ts`, remove `"get_financial_signals"` from `DASHBOARD_TOOL_ALLOWLIST`.

Expected allowlist:

```ts
const DASHBOARD_TOOL_ALLOWLIST = new Set([
  "get_realtime_quote",
  "get_options_chain",
  "run_algorithmic_strategy",
]);
```

- [ ] **Step 2: Remove Finance chat prompt promotion**

In `functions/api/agent/executor.ts`, remove the bullet describing `get_financial_signals` from `CHAT_SYSTEM_PROMPT`.

Expected behavior: the tool implementation may still exist for non-dashboard surfaces, but Finance Analyzer chat no longer advertises DeepEar as a first-class supported capability.

- [ ] **Step 3: Remove dashboard contract listing**

In `src/lib/finance-analyzer-contract.ts`, remove `"get_financial_signals"` from `DASHBOARD_AGENT_TOOL_NAMES`.

Expected list:

```ts
export const DASHBOARD_AGENT_TOOL_NAMES = [
  "get_realtime_quote",
  "get_options_chain",
  "run_algorithmic_strategy",
] as const;
```

- [ ] **Step 4: Remove frontend prompt and parsing**

In `src/components/finance-dashboard.tsx`:

```ts
// Remove:
import { DeepEarSignalsCard } from "./dashboard/deepear-signals";

// Remove from DashboardData:
financialSignals?: any[];

// Remove local variable:
let financialSignalsArray: any[] = [];

// Remove parser:
if (step.tool_name === "get_financial_signals" && resJson.signals && Array.isArray(resJson.signals)) {
  financialSignalsArray = resJson.signals;
}

// Remove finalData field:
financialSignals: financialSignalsArray,
```

Also rewrite the dashboard prompt so step 3 is gone and the remaining steps are renumbered.

- [ ] **Step 5: Remove DeepEar UI blocks**

In `src/components/finance-dashboard.tsx`, remove:

```tsx
{activeData?.financialSignals && activeData.financialSignals.length > 0 && (...)}
<DeepEarSignalsCard signals={activeData?.financialSignals || []} />
```

Expected result: no `DeepEar`, `高頻`, or `get_financial_signals` string remains in `src/components/finance-dashboard.tsx`.

### Task 2: Add Deterministic Trader Risk Snapshot

**Files:**
- Create: `src/lib/trader-risk-snapshot.ts`
- Create: `src/components/dashboard/trader-risk-snapshot-card.tsx`
- Modify: `src/components/finance-dashboard.tsx`

- [ ] **Step 1: Create risk metric utility**

Create `src/lib/trader-risk-snapshot.ts`:

```ts
export interface TraderRiskBar {
  label: string;
  value: string;
  tone: "green" | "amber" | "red" | "gray";
  detail: string;
}

export interface TraderRiskSnapshot {
  source: string;
  dollarVolume: number | null;
  relativeVolume: number | null;
  atr14: number | null;
  rangePositionPct: number | null;
  bars: TraderRiskBar[];
}

export interface TraderRiskCandle {
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

const formatCompactUsd = (value: number | null) => {
  if (!Number.isFinite(value || NaN) || value === null) return "Needs data";
  if (value >= 100_000_000) return `$${(value / 100_000_000).toFixed(2)}億`;
  if (value >= 10_000) return `$${(value / 10_000).toFixed(1)}萬`;
  return `$${Math.round(value).toLocaleString()}`;
};

const avg = (values: number[]) => {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export function deriveTraderRiskSnapshot(candles: TraderRiskCandle[]): TraderRiskSnapshot {
  const clean = candles
    .map((item) => ({
      close: Number(item.price),
      open: Number(item.open ?? item.price),
      high: Number(item.high ?? item.price),
      low: Number(item.low ?? item.price),
      volume: Number(item.volume),
    }))
    .filter((item) =>
      Number.isFinite(item.close) &&
      Number.isFinite(item.high) &&
      Number.isFinite(item.low) &&
      Number.isFinite(item.volume)
    );

  const latest = clean.at(-1);
  const prev20 = clean.slice(-21, -1);
  const last20 = clean.slice(-20);
  const dollarVolume = latest ? latest.close * latest.volume : null;
  const avg20Volume = avg(prev20.map((item) => item.volume));
  const relativeVolume = latest && avg20Volume ? latest.volume / avg20Volume : null;

  const atrWindow = clean.slice(-15);
  const trueRanges = atrWindow.slice(1).map((item, index) => {
    const prevClose = atrWindow[index].close;
    return Math.max(
      item.high - item.low,
      Math.abs(item.high - prevClose),
      Math.abs(item.low - prevClose),
    );
  });
  const atr14 = avg(trueRanges.slice(-14));

  const rangeHigh = Math.max(...last20.map((item) => item.high));
  const rangeLow = Math.min(...last20.map((item) => item.low));
  const rangePositionPct =
    latest && Number.isFinite(rangeHigh) && Number.isFinite(rangeLow) && rangeHigh > rangeLow
      ? ((latest.close - rangeLow) / (rangeHigh - rangeLow)) * 100
      : null;

  const bars: TraderRiskBar[] = [
    {
      label: "Dollar Volume",
      value: formatCompactUsd(dollarVolume),
      tone: dollarVolume && dollarVolume >= 1_000_000_000 ? "green" : dollarVolume ? "amber" : "gray",
      detail: "close x volume, Yahoo chart data",
    },
    {
      label: "Relative Volume",
      value: relativeVolume ? `${relativeVolume.toFixed(2)}x` : "Needs data",
      tone: relativeVolume === null ? "gray" : relativeVolume >= 1.5 ? "green" : relativeVolume < 0.7 ? "red" : "amber",
      detail: "latest volume vs prior 20-day average",
    },
    {
      label: "ATR 14",
      value: atr14 ? `$${atr14.toFixed(2)}` : "Needs data",
      tone: atr14 ? "amber" : "gray",
      detail: "14-day average true range",
    },
    {
      label: "20D Range Position",
      value: rangePositionPct === null ? "Needs data" : `${Math.round(rangePositionPct)}%`,
      tone: rangePositionPct === null ? "gray" : rangePositionPct >= 80 ? "green" : rangePositionPct <= 20 ? "red" : "amber",
      detail: "close location inside 20-day high-low range",
    },
  ];

  return {
    source: "Yahoo Finance chart data + local deterministic calculation",
    dollarVolume,
    relativeVolume,
    atr14,
    rangePositionPct,
    bars,
  };
}
```

- [ ] **Step 2: Create the dashboard card**

Create `src/components/dashboard/trader-risk-snapshot-card.tsx` using the utility above and render four compact metric rows. Use restrained dashboard styling, no nested cards, no marketing copy.

- [ ] **Step 3: Mount the card**

In `src/components/finance-dashboard.tsx`, import the card:

```ts
import { TraderRiskSnapshotCard } from "./dashboard/trader-risk-snapshot-card";
```

Render it in the right rail where `DeepEarSignalsCard` used to be:

```tsx
<TraderRiskSnapshotCard data={activeData?.chartData || []} />
```

### Task 3: Verification

**Files:**
- Modify only if needed: files from Task 1 and Task 2

- [ ] **Step 1: Search for Finance Analyzer DeepEar residue**

Run:

```powershell
Get-ChildItem -Path '.\src','.\functions' -Recurse -File |
  Select-String -Pattern 'DeepEar|高頻|deepear|get_financial_signals' -CaseSensitive:$false
```

Expected: no matches in Finance Analyzer dashboard path. Remaining matches in `alphaear-tools.ts` are acceptable only if final explains they are intentionally outside the selected boundary.

- [ ] **Step 2: Build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build pass. If PowerShell blocks `npm`, run `npm.cmd run build`.

- [ ] **Step 3: Browser smoke**

Start:

```powershell
npm run dev:all
```

Open `http://localhost:5173`, navigate by UI to AI VISION then Finance Analyzer, analyze `AAPL`, and confirm:

- no visible DeepEar text,
- no console runtime errors,
- trader risk snapshot displays deterministic metrics or `Needs data`,
- existing price/chart/options/news/VIX cards still render.

### Task 4: Closeout

**Files:**
- Update Obsidian memory only if the implementation discovers durable new facts.

- [ ] **Step 1: Report changed files**

List every modified file and why it changed.

- [ ] **Step 2: Report verification**

Report build result, browser smoke result, and any source-boundary residue.

- [ ] **Step 3: Report deploy status**

State clearly: no deploy was run unless the user explicitly asked.
