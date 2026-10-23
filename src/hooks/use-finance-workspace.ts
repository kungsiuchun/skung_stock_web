import { useEffect, useRef, useState } from "react";
import type { FinanceDashboardSnapshotPayload } from "@/lib/finance-dashboard-snapshot";
import type { MarketCacheMetadata } from "@/lib/market-data-cache";
import { parseJsonResponse } from "@/lib/safe-json-response";
import { loadDashboardPersistence, normalizeStoredDashboardSnapshot, type DashboardHistoryItem } from "@/lib/finance-dashboard-persistence";
import { writeBrowserJson } from "@/lib/browser-storage";
import { DASHBOARD_LOADING_PHASE_MS, getNextDashboardLoadingPhase } from "@/lib/finance-dashboard-loading";
import {
  applyDashboardSnapshot, beginDashboardAnalysis, completeDashboardAnalysis,
  EMPTY_DASHBOARD_SNAPSHOT_STATE, failDashboardAnalysis, restoreDashboardHistory,
} from "@/lib/finance-dashboard-state";

// Owns request ordering and persistence; research tabs never issue an analysis request.
export function useFinanceWorkspace() {
  const [persisted] = useState(loadDashboardPersistence);
  const [snapshot, setSnapshot] = useState(() => ({ ...EMPTY_DASHBOARD_SNAPSHOT_STATE, history: persisted.history, activeData: persisted.activeData }));
  const [storageWarnings, setStorageWarnings] = useState(persisted.warnings);
  const [symbol, setSymbol] = useState(persisted.activeData?.symbol || "");
  const savedHistoryRef = useRef(snapshot.history);
  const savedActiveRef = useRef(snapshot.activeData);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const pendingSymbolRef = useRef<string | null>(null);

  useEffect(() => () => { generationRef.current++; requestRef.current?.abort(); }, []);
  useEffect(() => {
    if (savedHistoryRef.current === snapshot.history) return;
    savedHistoryRef.current = snapshot.history;
    const warning = writeBrowserJson("finance_dashboard_history", snapshot.history);
    setStorageWarnings((current) => ({ ...current, history: warning }));
  }, [snapshot.history]);
  useEffect(() => {
    if (!snapshot.activeData || savedActiveRef.current === snapshot.activeData) return;
    savedActiveRef.current = snapshot.activeData;
    const warning = writeBrowserJson("finance_dashboard_active_data", snapshot.activeData);
    setStorageWarnings((current) => ({ ...current, active: warning }));
  }, [snapshot.activeData]);
  useEffect(() => {
    if (!snapshot.loadingPhase) return;
    const timer = window.setInterval(() => setSnapshot((current) => ({
      ...current, loadingPhase: current.loadingPhase ? getNextDashboardLoadingPhase(current.loadingPhase) : null,
    })), DASHBOARD_LOADING_PHASE_MS);
    return () => window.clearInterval(timer);
  }, [snapshot.loadingPhase]);

  const analyze = async (requestedSymbol = symbol) => {
    const analyzedSymbol = requestedSymbol.trim().toUpperCase();
    if (!analyzedSymbol || pendingSymbolRef.current === analyzedSymbol) return;
    // Changing ticker supersedes the previous request; a late response cannot replace it.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    pendingSymbolRef.current = analyzedSymbol;
    const generation = ++generationRef.current;
    setSymbol(analyzedSymbol);
    setSnapshot(beginDashboardAnalysis);
    try {
      const response = await fetch("/api/finance-dashboard/snapshot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: analyzedSymbol }), signal: controller.signal,
      });
      const payload = await parseJsonResponse<{
        data?: FinanceDashboardSnapshotPayload; cache?: MarketCacheMetadata; error?: string;
      }>(response, "/api/finance-dashboard/snapshot", { allowHttpError: true });
      if ((response.status !== 200 && response.status !== 206) || !payload.data || !payload.cache) {
        throw new Error(payload.error || `分析快照請求失敗（HTTP ${response.status}）。`);
      }
      const normalizedPayload = normalizeStoredDashboardSnapshot(payload.data);
      if (!normalizedPayload) throw new Error("回傳快照資料無效，已拒絕顯示。請重新查詢。");
      if (generation !== generationRef.current) return;
      if (normalizedPayload.data.symbol.toUpperCase() !== analyzedSymbol) throw new Error("回傳標的與查詢不符，已拒絕顯示。請重新查詢。");
      setSnapshot((current) => applyDashboardSnapshot(current, normalizedPayload, payload.cache!, analyzedSymbol, new Date().toLocaleTimeString()));
    } catch (error) {
      if (generation !== generationRef.current || controller.signal.aborted) return;
      console.error("Finance snapshot failed:", error);
      setSnapshot((current) => failDashboardAnalysis(current, error instanceof Error ? error.message : String(error)));
    } finally {
      if (generation === generationRef.current) {
        requestRef.current = null;
        pendingSymbolRef.current = null;
        setSnapshot(completeDashboardAnalysis);
      }
    }
  };
  const selectHistory = (item: DashboardHistoryItem) => {
    setSymbol(item.symbol);
    if (!item.fullData) { void analyze(item.symbol); return; }
    generationRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    pendingSymbolRef.current = null;
    setSnapshot((current) => restoreDashboardHistory(current, item.fullData!));
  };
  return {
    ...snapshot, symbol, setSymbol, analyze, selectHistory,
    clearHistory: () => setSnapshot((current) => ({ ...current, history: [] })),
    warnings: [...new Set(Object.values(storageWarnings).filter(Boolean))],
  };
}
