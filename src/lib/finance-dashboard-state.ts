import type { MarketCacheMetadata } from "./market-data-cache";
import type { FinanceDashboardSnapshotPayload } from "./finance-dashboard-snapshot";
import type { DashboardHistoryItem } from "./finance-dashboard-persistence";
import type { DashboardLoadingPhase } from "./finance-dashboard-loading";

export interface DashboardSnapshotState {
  activeData: FinanceDashboardSnapshotPayload["data"] | null;
  cache: MarketCacheMetadata | null;
  history: DashboardHistoryItem[];
  loading: boolean;
  loadingPhase: DashboardLoadingPhase | null;
  error: string | null;
  technicalData: any;
  valuationData: any;
  vixData: any;
}

export const EMPTY_DASHBOARD_SNAPSHOT_STATE: DashboardSnapshotState = {
  activeData: null,
  cache: null,
  history: [],
  loading: false,
  loadingPhase: null,
  error: null,
  technicalData: null,
  valuationData: null,
  vixData: null,
};

export const applyDashboardSnapshot = (
  current: DashboardSnapshotState,
  snapshot: FinanceDashboardSnapshotPayload,
  cache: MarketCacheMetadata,
  symbol: string,
  timestamp: string,
): DashboardSnapshotState => {
  const normalizedSymbol = symbol.toUpperCase();
  return {
    ...current,
    activeData: snapshot.data,
    cache,
    history: [
      {
        symbol: normalizedSymbol,
        timestamp,
        score: snapshot.data.algoRating,
        fullData: snapshot.data,
      },
      ...current.history.filter((item) => item.symbol !== normalizedSymbol).slice(0, 4),
    ],
    technicalData: snapshot.technicalData,
    valuationData: snapshot.valuationData,
    vixData: snapshot.vixData,
  };
};

export const beginDashboardAnalysis = (current: DashboardSnapshotState): DashboardSnapshotState => ({
  ...current,
  activeData: null,
  error: null,
  loading: true,
  loadingPhase: "market",
});

export const failDashboardAnalysis = (current: DashboardSnapshotState, error: string): DashboardSnapshotState => ({
  ...current,
  error,
  loading: false,
  loadingPhase: null,
});

export const completeDashboardAnalysis = (current: DashboardSnapshotState): DashboardSnapshotState => ({
  ...current,
  loading: false,
  loadingPhase: null,
});
