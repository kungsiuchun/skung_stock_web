import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_WORKSPACE_SAVED, WORKSPACE_STORAGE_KEY, parseWorkspaceHistory, parseWorkspaceQuotes, parseWorkspaceSaved, workspaceSymbol, type WorkspaceBar, type WorkspaceQuote, type WorkspaceSaved } from "@/lib/watcher-workspace";
import { validateMarketContext, type MarketContextSnapshot } from "@/lib/market-context";
import type { StocksWatcherSnapshot } from "@/lib/stocks-intelligence-watcher";

export interface WorkspaceResource<T> { data: T | null; loading: boolean; error: string | null; errorDetail?: string | null }
export interface WorkspaceTool { raw: unknown; text: string; cache?: { status: string; sourceAsOf?: string | null; cachedAt?: string; lastRefreshError?: string | null } }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export interface WorkspaceSaveResult { saved: WorkspaceSaved | null; error: string | null; detail: string | null }

export function persistWorkspaceSaved(storage: Pick<Storage, "setItem">, next: WorkspaceSaved, corrupt: boolean, replaceCorrupt = false): WorkspaceSaveResult {
  const checked = parseWorkspaceSaved(next);
  if (corrupt && !replaceCorrupt) return { saved: null, error: "Saved workspace is invalid. Export it or replace it before saving.", detail: "The original browser data was preserved." };
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(checked));
    return { saved: checked, error: null, detail: null };
  } catch (error) {
    return { saved: null, error: "Workspace changes were not saved on this browser. Export your workspace before closing.", detail: message(error) };
  }
}

/** One session cache + two request lanes. There is no background quote polling. */
export function createWorkspaceClient() {
  const cache = new Map<string, { value: WorkspaceTool; expires: number }>();
  const snapshots = new Map<string, { value: StocksWatcherSnapshot; expires: number }>();
  const active = new Set<AbortController>();
  let generation = 0;
  let running = 0;
  const waiting: Array<() => void> = [];
  async function tool(name: string, params: Record<string, unknown> = {}, signal?: AbortSignal, force = false): Promise<WorkspaceTool> {
    const requestGeneration = generation;
    const key = JSON.stringify([name, params]);
    const hit = cache.get(key);
    if (!force && hit && hit.expires > Date.now()) return hit.value;
    if (running >= 2) await new Promise<void>(resolve => waiting.push(resolve));
    if (signal?.aborted || requestGeneration !== generation) { waiting.shift()?.(); throw new DOMException("Superseded request", "AbortError"); }
    running++;
    const deadline = new AbortController();
    active.add(deadline);
    const abort = () => deadline.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(abort, 30_000);
    try {
      const response = await fetch("/api/stocks-intelligence-watcher", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: name, params }), signal: deadline.signal });
      const body = await response.json() as WorkspaceTool & { ok?: boolean; error?: string };
      if (!response.ok || body.ok === false || body.raw === undefined) throw new Error(body.error || `Market data is unavailable (HTTP ${response.status}).`);
      if (requestGeneration !== generation) throw new DOMException("Superseded request", "AbortError");
      if (cache.size >= 100) cache.delete(cache.keys().next().value as string);
      cache.set(key, { value: body, expires: Date.now() + (name === "get_quotes" ? 60_000 : 15 * 60_000) });
      return body;
    } catch (error) {
      if (requestGeneration !== generation) throw new DOMException("Superseded request", "AbortError");
      if (deadline.signal.aborted && !signal?.aborted) throw new Error("Market data request timed out. Use Refresh to retry.");
      throw error;
    } finally { window.clearTimeout(timer); active.delete(deadline); signal?.removeEventListener("abort", abort); running--; waiting.shift()?.(); }
  }
  async function optionsSnapshot(symbol: string, signal?: AbortSignal) {
    const requestGeneration = generation;
    const cached = snapshots.get(symbol);
    if (cached && cached.expires > Date.now()) return cached.value;
    const controller = new AbortController(); const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    active.add(controller);
    const timer = window.setTimeout(abort, 45_000);
    let response: Response; let value: StocksWatcherSnapshot & { error?: string };
    try { response = await fetch(`/api/stocks-intelligence-watcher?symbol=${encodeURIComponent(symbol)}&surface=options`, { signal: controller.signal }); value = await response.json(); }
    finally { window.clearTimeout(timer); active.delete(controller); signal?.removeEventListener("abort", abort); }
    if (requestGeneration !== generation) throw new DOMException("Superseded request", "AbortError");
    if (!response.ok || value.symbol !== symbol || !value.quote) throw new Error(value.error || "The options snapshot could not be verified.");
    if (snapshots.size >= 20) snapshots.delete(snapshots.keys().next().value as string);
    snapshots.set(symbol, { value, expires: Date.now() + 60_000 });
    return value;
  }
  const invalidate = () => { generation++; cache.clear(); snapshots.clear(); for (const controller of active) controller.abort(); };
  return { tool, optionsSnapshot, invalidate };
}
export type WorkspaceClient = ReturnType<typeof createWorkspaceClient>;

export function useWorkspaceSaved() {
  const [initial] = useState(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
      return { data: raw ? parseWorkspaceSaved(JSON.parse(raw)) : EMPTY_WORKSPACE_SAVED, error: null as string | null, detail: null as string | null, original: raw };
    } catch (error) { return { data: EMPTY_WORKSPACE_SAVED, error: "Saved workspace could not be loaded. Export remains available; saved data will not be overwritten.", detail: message(error), original: raw }; }
  });
  const [saved, setSaved] = useState(initial.data);
  const [storageError, setStorageError] = useState(initial.error);
  const [storageErrorDetail, setStorageErrorDetail] = useState(initial.detail);
  const corruptStorage = useRef(Boolean(initial.error));
  const [preservedData, setPreservedData] = useState(initial.error ? initial.original : null);
  const updateSaved = useCallback((next: WorkspaceSaved, replaceCorrupt = false) => {
    const result = persistWorkspaceSaved(localStorage, next, corruptStorage.current, replaceCorrupt);
    if (!result.saved) { setStorageError(result.error); setStorageErrorDetail(result.detail); return false; }
    setSaved(result.saved);
    corruptStorage.current = false;
    setStorageError(null);
    setStorageErrorDetail(null);
    if (replaceCorrupt) setPreservedData(null);
    return true;
  }, []);
  return { saved, updateSaved, storageError, storageErrorDetail, preservedData };
}

export function useWatcherWorkspace(symbol: string, customs: string[], active: boolean) {
  const [client] = useState(createWorkspaceClient);
  const [revision, setRevision] = useState(0);
  const [watchlist, setWatchlist] = useState<WorkspaceResource<string[]>>({ data: null, loading: false, error: null });
  const [quotes, setQuotes] = useState<WorkspaceResource<WorkspaceQuote[]>>({ data: null, loading: false, error: null });
  const [context, setContext] = useState<WorkspaceResource<MarketContextSnapshot & { freshness?: { status: string } }>>({ data: null, loading: false, error: null });
  const [research, setResearch] = useState<{ symbol: string; quote: WorkspaceQuote | null; bars: WorkspaceBar[]; rejected: number; loading: boolean; error: string | null; errorDetail: string | null; stale: boolean }>({ symbol, quote: null, bars: [], rejected: 0, loading: false, error: null, errorDetail: null, stale: false });
  const quotesRef = useRef<WorkspaceQuote[]>([]);
  const quotesFetchedAt = useRef(0);
  const customKey = customs.join(",");
  const coreActive = active;
  useEffect(() => {
    if (!coreActive) return;
    const controller = new AbortController();
    let current = true;
    setWatchlist({ data: null, loading: true, error: null, errorDetail: null });
    setQuotes({ data: null, loading: true, error: null, errorDetail: null });
    void client.tool("get_watchlist", {}, controller.signal, revision > 0).then(async result => {
      const raw = result.raw as { source?: string; symbols?: unknown[]; stocks?: Array<{ symbol?: unknown }> };
      if (raw.source !== "d1_tracking") throw new Error("The curated watchlist source could not be verified.");
      const symbols = (raw.symbols || raw.stocks?.map(s => s.symbol) || []).map(workspaceSymbol);
      if (!symbols.length || symbols.length > 20) throw new Error("The curated watchlist is empty or exceeds its 20-stock limit.");
      if (!current) return;
      setWatchlist({ data: symbols, loading: false, error: null, errorDetail: null });
      const requested = Array.from(new Set([...symbols, ...customKey.split(",").filter(Boolean)]));
      const all: WorkspaceQuote[] = [];
      for (let index = 0; index < requested.length; index += 20) {
        const quoteResult = await client.tool("get_quotes", { tickers: requested.slice(index, index + 20).join(",") }, controller.signal, revision > 0);
        all.push(...parseWorkspaceQuotes(quoteResult.raw));
        if (quoteResult.cache?.status === "stale") throw new Error("Watchlist quotes are stale. Refresh is required.");
      }
      if (current) { const missing = requested.filter(symbol => !all.some(row => row.symbol === symbol)); quotesRef.current = all; quotesFetchedAt.current = Date.now(); setQuotes({ data: all, loading: false, error: missing.length ? missing.length === requested.length ? "Quotes are unavailable for the requested symbols." : `Quotes unavailable for ${missing.join(", ")}. Other prices remain available.` : null, errorDetail: null }); }
    }).catch(error => { if (current) { const detail = message(error); setWatchlist(state => ({ ...state, loading: false, error: state.data ? null : "Watchlist data is unavailable.", errorDetail: state.data ? null : detail })); setQuotes({ data: null, loading: false, error: "Quotes are unavailable.", errorDetail: detail }); } });
    return () => { current = false; controller.abort(); };
  }, [client, revision, customKey, coreActive]);

  useEffect(() => {
    if (!coreActive) return;
    const controller = new AbortController();
    setContext({ data: null, loading: true, error: null, errorDetail: null });
    void fetch("/api/market-context", { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Market context is unavailable.");
      const checked = validateMarketContext(data);
      if (!controller.signal.aborted) setContext({ data: { ...checked, freshness: data.freshness }, loading: false, error: null, errorDetail: null });
    }).catch(error => { if (!controller.signal.aborted) setContext({ data: null, loading: false, error: "Market summary is unavailable.", errorDetail: message(error) }); });
    return () => controller.abort();
  }, [revision, coreActive]);

  useEffect(() => {
    if (!coreActive) return;
    const controller = new AbortController();
    setResearch({ symbol, quote: null, bars: [], rejected: 0, loading: true, error: null, errorDetail: null, stale: false });
    const quote = Date.now() - quotesFetchedAt.current < 60_000 ? quotesRef.current.find(row => row.symbol === symbol) : undefined;
    const quotePromise = quote && revision === 0 ? Promise.resolve({ raw: { source: "native_yahoo", quotes: [quote] } } as WorkspaceTool) : client.tool("get_quotes", { tickers: symbol }, controller.signal, revision > 0);
    void Promise.allSettled([quotePromise, client.tool("get_stock_history", { ticker: symbol, range: "1y", interval: "1d" }, controller.signal, revision > 0)]).then(results => {
      if (controller.signal.aborted) return;
      const errors: string[] = [];
      let quote: WorkspaceQuote | null = null; let bars: WorkspaceBar[] = []; let rejected = 0; let stale = false;
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") { errors.push(message(result.reason)); continue; }
        stale ||= result.value.cache?.status === "stale";
        try {
          if (index === 0) { quote = parseWorkspaceQuotes(result.value.raw).find(row => row.symbol === symbol) ?? null; if (!quote) throw new Error("Requested quote identity is missing."); }
          else { const data = parseWorkspaceHistory(result.value.raw, symbol); bars = data.bars; rejected = data.rejected; }
        } catch (error) { errors.push(message(error)); }
      }
      setResearch({ symbol, quote, bars, rejected, loading: false, error: errors.length ? "Research data is unavailable." : null, errorDetail: errors.join(" ") || null, stale });
    });
    return () => controller.abort();
  }, [client, symbol, revision, coreActive]);
  const visibleResearch = useMemo(() => research.symbol === symbol ? research : { symbol, quote: null, bars: [], rejected: 0, loading: true, error: null, errorDetail: null, stale: false }, [research, symbol]);
  return { client, watchlist, quotes, context, research: visibleResearch, refreshRevision: revision, refresh: () => { client.invalidate(); setRevision(value => value + 1); } };
}
