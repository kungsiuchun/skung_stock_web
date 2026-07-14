export type DashboardLoadingPhase = "market" | "options" | "quant" | "synthesis";

export const DASHBOARD_LOADING_PHASES: DashboardLoadingPhase[] = ["market", "options", "quant", "synthesis"];
export const DASHBOARD_LOADING_PHASE_MS = 1400;

export const DASHBOARD_LOADING_LABELS: Record<DashboardLoadingPhase, string> = {
  market: "正在抓取行情資料",
  options: "正在整理期權曝險",
  quant: "正在執行 11 個量化策略",
  synthesis: "AI 正在整合分析",
};

export const getNextDashboardLoadingPhase = (phase: DashboardLoadingPhase): DashboardLoadingPhase => {
  const index = DASHBOARD_LOADING_PHASES.indexOf(phase);
  return DASHBOARD_LOADING_PHASES[Math.min(index + 1, DASHBOARD_LOADING_PHASES.length - 1)];
};
