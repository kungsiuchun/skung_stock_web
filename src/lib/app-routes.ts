export type ViewState =
  | "home"
  | "about"
  | "work-gallery"
  | "settle-up"
  | "finance-dashboard"
  | "trading-agent-dashboard"
  | "spx-recap"
  | "spx-gex-heatmap"
  | "stocks-intelligence-watcher";

const VIEW_HASHES: Record<ViewState, string> = {
  home: "#/",
  about: "#/about",
  "work-gallery": "#/work",
  "settle-up": "#/work/settle-up",
  "finance-dashboard": "#/work/finance-analyzer",
  "trading-agent-dashboard": "#/work/trading-agent-dashboard",
  "spx-recap": "#/work/spx-recap",
  "spx-gex-heatmap": "#/work/spx-gex-heatmap",
  "stocks-intelligence-watcher": "#/work/stocks-intelligence-watcher",
};

export const getHashForView = (view: ViewState): string => VIEW_HASHES[view];

export const getViewFromHash = (hash: string): ViewState => {
  if (!hash || hash === "#/" || hash === "#") {
    return "home";
  }

  if (hash.startsWith("#/about")) {
    return "about";
  }

  if (hash.startsWith("#/work/settle-up")) {
    return "settle-up";
  }

  if (hash.startsWith("#/work/finance-analyzer") || hash.startsWith("#/work/finance-dashboard")) {
    return "finance-dashboard";
  }

  if (hash.startsWith("#/work/trading-agent-dashboard")) {
    return "trading-agent-dashboard";
  }

  if (hash.startsWith("#/work/spx-recap")) {
    return "spx-recap";
  }

  if (hash.startsWith("#/work/spx-gex-heatmap")) {
    return "spx-gex-heatmap";
  }

  if (hash.startsWith("#/work/stocks-intelligence-watcher")) {
    return "stocks-intelligence-watcher";
  }

  if (hash === "#/work" || hash.startsWith("#/work?")) {
    return "work-gallery";
  }

  return "home";
};
