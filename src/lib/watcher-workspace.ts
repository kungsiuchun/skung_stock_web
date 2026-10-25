import { deriveTraderRiskSnapshot, isValidTraderRiskCandle } from "./trader-risk-snapshot";

export const WORKSPACE_PATH = "#/work/stocks-intelligence-watcher";
export const WORKSPACE_SECTIONS = ["today", "markets", "research", "plans", "portfolio", "spx"] as const;
export const RESEARCH_TABS = ["Chart", "Technicals", "Fundamentals", "Earnings", "Options", "News", "Report"] as const;
export type WorkspaceSection = typeof WORKSPACE_SECTIONS[number];
export type ResearchTab = typeof RESEARCH_TABS[number];
export type WorkspaceRange = "1mo" | "3mo" | "1y";
export const workspaceSymbol = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Z0-9.^-]{1,12}$/.test(value.trim().toUpperCase())) throw new Error("Enter a valid ticker, up to 12 characters.");
  return value.trim().toUpperCase();
};
export interface WorkspaceRoute { section: WorkspaceSection; symbol: string; tab: ResearchTab; range: WorkspaceRange; market: string; expiry: string | null }
export function readWorkspaceRoute(hash: string, fallbackSymbol = "NVDA"): WorkspaceRoute {
  const query = new URLSearchParams(hash.split("?")[1] || "");
  let symbol = fallbackSymbol;
  if (query.has("symbol")) symbol = workspaceSymbol(query.get("symbol"));
  const legacySection = /portfolio-backtest/.test(hash) ? "portfolio" : /spx-/.test(hash) ? "spx" : /market-breadth|sector-rotation|fixed-income/.test(hash) ? "markets" : /finance-|trading-agent/.test(hash) ? "research" : "today";
  const canonical = hash.startsWith(WORKSPACE_PATH);
  const section = (canonical ? query.get("view") : null) || legacySection;
  const tab = (canonical ? query.get("tab") : null) || (/trading-agent/.test(hash) ? "Report" : "Chart");
  const range = (canonical ? query.get("range") : null) || "3mo";
  if (!WORKSPACE_SECTIONS.includes(section as WorkspaceSection) || !RESEARCH_TABS.includes(tab as ResearchTab) || !["1mo", "3mo", "1y"].includes(range)) throw new Error("This Watcher link has an invalid view, tab or range.");
  const market = query.get("market") || (/sector-rotation/.test(hash) ? "rotation" : /market-breadth/.test(hash) ? "breadth" : /fixed-income/.test(hash) ? "rates" : "overview");
  const expiry = canonical ? query.get("expiry") : null;
  if (expiry && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(Date.parse(expiry)) || new Date(expiry).toISOString().slice(0, 10) !== expiry)) throw new Error("The option expiration in this link is invalid.");
  return { section: section as WorkspaceSection, symbol, tab: tab as ResearchTab, range: range as WorkspaceRange, market, expiry };
}
export const workspaceHref = (route: WorkspaceRoute, change: Partial<WorkspaceRoute> = {}) => {
  const next = { ...route, ...change };
  const params = new URLSearchParams({ view: next.section, symbol: next.symbol, tab: next.tab, range: next.range, market: next.market });
  if (next.expiry) params.set("expiry", next.expiry);
  return `${WORKSPACE_PATH}?${params}`;
};

export interface WorkspaceQuote { symbol: string; name: string; price: number; change: number | null; changePercent: number | null; asOf: string | null; currency: string; marketState: string; warning?: string }
export interface WorkspaceBar { date: string; open: number; high: number; low: number; close: number; volume: number }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected structured market data.");
  return value as Record<string, unknown>;
};
const nullableNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
export function parseWorkspaceQuotes(value: unknown): WorkspaceQuote[] {
  const raw = object(value);
  if (!Array.isArray(raw.quotes)) throw new Error("Quote data is unavailable.");
  return raw.quotes.map(value => {
    const row = object(value);
    const symbol = workspaceSymbol(row.symbol);
    if (typeof row.price !== "number" || !Number.isFinite(row.price) || row.price <= 0) throw new Error(`Quote is invalid for ${symbol}.`);
    return { symbol, name: typeof row.name === "string" ? row.name : symbol, price: row.price, change: row.changeAvailable === false ? null : nullableNumber(row.change), changePercent: row.changeAvailable === false ? null : nullableNumber(row.changePercent),
      asOf: typeof row.asOf === "string" && Number.isFinite(Date.parse(row.asOf)) ? row.asOf : null, currency: typeof row.currency === "string" ? row.currency : "Unknown currency", marketState: typeof row.marketState === "string" ? row.marketState : "Unknown session", ...(typeof row.warning === "string" ? { warning: row.warning } : {}) };
  });
}
export function parseWorkspaceHistory(value: unknown) {
  const raw = object(value);
  if (!Array.isArray(raw.history) || !raw.history.length) throw new Error("Price history is unavailable.");
  let previous = "";
  if (raw.rejected_bar_count !== undefined && (!Number.isInteger(raw.rejected_bar_count) || (raw.rejected_bar_count as number) < 0)) throw new Error("Price history quality metadata is invalid.");
  let rejected = typeof raw.rejected_bar_count === "number" ? raw.rejected_bar_count : 0;
  const bars: WorkspaceBar[] = [];
  for (const value of raw.history) {
    if (!value || typeof value !== "object" || Array.isArray(value)) { rejected++; continue; }
    const row = object(value);
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date))
      || new Date(row.date).toISOString().slice(0, 10) !== row.date || row.date <= previous
      || !isValidTraderRiskCandle({ price: row.close as number, open: row.open as number, high: row.high as number, low: row.low as number, volume: row.volume as number })) { rejected++; continue; }
    previous = row.date;
    bars.push({ date: row.date, open: row.open as number, high: row.high as number, low: row.low as number, close: row.close as number, volume: row.volume as number });
  }
  if (!bars.length) throw new Error("No valid price bars were supplied.");
  return { bars, rejected };
}
export function deriveWorkspaceEvidence(bars: WorkspaceBar[], rejected = 0) {
  const risk = deriveTraderRiskSnapshot(bars.map(row => ({ ...row, price: row.close })), rejected);
  const average = (period: number) => !rejected && bars.length >= period ? bars.slice(-period).reduce((sum, row) => sum + row.close, 0) / period : null;
  const latest = bars[bars.length - 1];
  const recent = !rejected && bars.length >= 20 ? bars.slice(-20) : [];
  return { ...risk, sma20: average(20), sma50: average(50), sma200: average(200), lastDate: latest?.date ?? null,
    recentLow: recent.length ? Math.min(...recent.map(row => row.low)) : null, recentHigh: recent.length ? Math.max(...recent.map(row => row.high)) : null };
}

export interface TradePlan {
  id: string; symbol: string; direction: "long" | "short"; entry: number; stop: number; target: number | null; riskBudget: number;
  thesis: string; invalidation: string; status: "Watching" | "Ready" | "Active" | "Closed"; createdAt: string; sourceAsOf: string | null;
}
export function calculateTradePlan(plan: Pick<TradePlan, "entry" | "stop" | "target" | "riskBudget" | "direction">) {
  if (![plan.entry, plan.stop, plan.riskBudget].every(n => typeof n === "number" && Number.isFinite(n) && n > 0) || !["long", "short"].includes(plan.direction)) throw new Error("Entry, stop and risk budget must be positive numbers.");
  const scale = 1_000_000;
  const units = (value: number) => { const result = Math.round(value * scale); if (!Number.isSafeInteger(result) || result <= 0 || result / scale !== value) throw new Error("Use positive USD amounts with at most six decimal places, within supported numeric limits."); return result; };
  const entry = units(plan.entry), stop = units(plan.stop), budget = units(plan.riskBudget);
  const distance = plan.direction === "long" ? entry - stop : stop - entry;
  if (distance <= 0) throw new Error("For a long plan, stop must be below entry. For a short plan, stop must be above entry.");
  const reward = plan.target === null ? null : plan.direction === "long" ? units(plan.target) - entry : entry - units(plan.target);
  if (reward !== null && reward <= 0) throw new Error("Target must be above entry for long, below entry for short.");
  const shares = Math.floor(budget / distance);
  if (!Number.isSafeInteger(shares) || shares < 1) throw new Error("Risk budget is too small for one whole share.");
  const positionUnits = shares * entry;
  if (!Number.isSafeInteger(positionUnits)) throw new Error("Position exceeds supported numeric limits.");
  return { shares, riskPerShare: distance / scale, actualRisk: shares * distance / scale, position: positionUnits / scale, rewardRisk: reward === null ? null : reward / distance };
}
export interface WorkspaceSaved { version: 1; tags: Record<string, "Holding" | "Candidate">; plans: TradePlan[]; customSymbols: string[] }
export const EMPTY_WORKSPACE_SAVED: WorkspaceSaved = { version: 1, tags: {}, plans: [], customSymbols: [] };
export const WORKSPACE_STORAGE_KEY = "watcher-workspace-v1";
export function parseWorkspaceSaved(value: unknown): WorkspaceSaved {
  const raw = object(value);
  if (raw.version !== 1 || !Array.isArray(raw.plans) || raw.plans.length > 200 || !Array.isArray(raw.customSymbols) || raw.customSymbols.length > 20) throw new Error("Saved workspace has an invalid version or size. Existing data was preserved.");
  const tags = object(raw.tags);
  if (Object.keys(tags).length > 100) throw new Error("Too many saved tags.");
  for (const [symbol, tag] of Object.entries(tags)) if (workspaceSymbol(symbol) !== symbol || !["Holding", "Candidate"].includes(tag as string)) throw new Error("Saved watchlist tags are invalid.");
  const plans = raw.plans.map(value => {
    const row = object(value) as unknown as TradePlan;
    workspaceSymbol(row.symbol); calculateTradePlan(row);
    if (typeof row.id !== "string" || row.id.length > 80 || !row.id || typeof row.thesis !== "string" || row.thesis.length > 2000 || typeof row.invalidation !== "string" || row.invalidation.length > 2000
      || !["Watching", "Ready", "Active", "Closed"].includes(row.status) || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) || row.sourceAsOf !== null && (typeof row.sourceAsOf !== "string" || !Number.isFinite(Date.parse(row.sourceAsOf)))) throw new Error("A saved plan is invalid. Existing data was preserved.");
    return { id: row.id, symbol: row.symbol, direction: row.direction, entry: row.entry, stop: row.stop, target: row.target, riskBudget: row.riskBudget, thesis: row.thesis, invalidation: row.invalidation, status: row.status, createdAt: row.createdAt, sourceAsOf: row.sourceAsOf };
  });
  if (new Set(plans.map(p => p.id)).size !== plans.length) throw new Error("Duplicate saved plan identity.");
  return { version: 1, tags: { ...tags } as WorkspaceSaved["tags"], plans, customSymbols: Array.from(new Set(raw.customSymbols.map(workspaceSymbol))) };
}
