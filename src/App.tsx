import { lazy, Suspense, useEffect, useRef, useState } from "react";
import "./portfolio.css";
const PhotographyPage = lazy(() => import("./components/photography-page"));
import Navbar from "./components/navbar";
const AICaptionTool = lazy(() => import("./components/ai-caption-tool"));
import { HomeLandingPage } from "./components/home-landing-page";
const FinanceDashboard = lazy(() =>
  import("./components/finance-dashboard").then((module) => ({
    default: module.FinanceDashboard,
  })),
);
const TradingAgentDashboard = lazy(() =>
  import("./components/dashboard/trading-agent-dashboard").then((module) => ({
    default: module.TradingAgentDashboard,
  })),
);
const SPXRecapPage = lazy(() =>
  import("./components/spx-recap-page").then((module) => ({
    default: module.SPXRecapPage,
  })),
);
const SPXGexHeatmapPage = lazy(() =>
  import("./components/spx-gex-heatmap-page").then((module) => ({
    default: module.SPXGexHeatmapPage,
  })),
);
const StocksIntelligenceWatcherPage = lazy(() =>
  import("./components/stocks-intelligence-watcher-page").then((module) => ({
    default: module.StocksIntelligenceWatcherPage,
  })),
);
const FixedIncomePage = lazy(() =>
  import("./components/fixed-income-page").then((module) => ({
    default: module.FixedIncomePage,
  })),
);
const MarketBreadthPage = lazy(() =>
  import("./components/market-breadth-page").then((module) => ({
    default: module.MarketBreadthPage,
  })),
);
const PortfolioBacktestPage = lazy(() =>
  import("./components/portfolio-backtest-page").then((module) => ({
    default: module.PortfolioBacktestPage,
  })),
);
const AboutPage = lazy(() =>
  import("./components/about-page").then((module) => ({
    default: module.AboutPage,
  })),
);
const ContactPage = lazy(() =>
  import("./components/contact-page").then((module) => ({
    default: module.ContactPage,
  })),
);
const WorkGallery = lazy(() =>
  import("./components/work-gallery").then((module) => ({
    default: module.WorkGallery,
  })),
);
const SettleUpPage = lazy(() =>
  import("./components/settle-up-page").then((module) => ({
    default: module.SettleUpPage,
  })),
);
import {
  getHashForView,
  getViewFromHash,
  type ViewState,
} from "@/lib/app-routes";
import { ArrowLeft, Home, LineChart } from "lucide-react";

function App() {
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isFinanceChatOpen, setIsFinanceChatOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>(() =>
    typeof window === "undefined"
      ? "home"
      : getViewFromHash(window.location.hash),
  );
  const isPortfolioView = [
    "home",
    "about",
    "contact",
    "photography",
    "work-gallery",
  ].includes(currentView);
  const mainRef = useRef<HTMLElement>(null);
  const previousView = useRef(currentView);
  useEffect(() => {
    const names: Partial<Record<ViewState, string>> = {
      home: "Code & Camera",
      about: "About & résumé",
      photography: "Photo journal",
      contact: "Contact",
      "work-gallery": "Market Lab",
    };
    document.title = (names[currentView] || "Market Lab") + " — Siu";
    if (previousView.current !== currentView) {
      window.scrollTo({ top: 0, behavior: "instant" });
      mainRef.current?.focus({ preventScroll: true });
      previousView.current = currentView;
    }
  }, [currentView]);
  const isFullScreenLabView = [
    "finance-dashboard",
    "spx-gex-heatmap",
    "stocks-intelligence-watcher",
    "fixed-income",
    "market-breadth",
    "portfolio-backtest",
  ].includes(currentView);

  useEffect(() => {
    const syncViewFromHash = () => {
      setCurrentView(getViewFromHash(window.location.hash));
    };

    syncViewFromHash();
    window.addEventListener("hashchange", syncViewFromHash);

    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  const navigateToView = (view: ViewState) => {
    if (typeof window === "undefined") {
      return;
    }

    window.location.hash = getHashForView(view);
  };

  return (
    <>
      <button className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to content
      </button>
      <main
        ref={mainRef}
        tabIndex={-1}
        className={
          isPortfolioView
            ? "portfolio-shell"
            : "relative min-h-dvh w-full overflow-visible bg-[#141414] lg:h-screen lg:overflow-hidden"
        }
      >
        {!isFullScreenLabView && <Navbar currentView={currentView} />}

        <div
          className={
            isPortfolioView
              ? "portfolio-page"
              : `flex min-h-dvh w-full overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden ${currentView === "home" || currentView === "contact" || isFullScreenLabView ? "" : "pt-20"}`
          }
        >
          {/* Left App Navigation Component - ONLY active during Finance Dashboard */}
          {currentView === "finance-dashboard" && (
            <div className="w-16 h-full flex flex-col items-center py-8 border-r border-white/5 bg-[#0a0f16] z-50 shrink-0">
              <button
                type="button"
                title="Back to Market Lab"
                aria-label="Back to Market Lab"
                onClick={() => navigateToView("work-gallery")}
                className="mb-5 rounded-lg border border-white/10 p-3 text-white/60 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-300"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex flex-col gap-4 bg-white/5 rounded-full p-2 border border-white/10 shadow-xl">
                <button
                  title="Dashboard view"
                  onClick={() => {
                    setIsFinanceChatOpen(false);
                  }}
                  className={`p-3 rounded-full transition-colors ${!isFinanceChatOpen ? "bg-cyan-500/20 text-cyan-400" : "text-white/50 hover:text-white"}`}
                >
                  <Home className="w-5 h-5" />
                </button>
                <button
                  title="Analyzer (Chat Bot)"
                  onClick={() => setIsFinanceChatOpen(true)}
                  className={`p-3 rounded-full transition-colors ${isFinanceChatOpen ? "bg-cyan-500/20 text-cyan-400" : "text-white/50 hover:text-white"}`}
                >
                  <LineChart className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          <div
            className={
              isPortfolioView
                ? "portfolio-content"
                : "min-w-0 flex-1 overflow-visible lg:h-full lg:overflow-hidden"
            }
          >
            <Suspense
              fallback={
                <p role="status" className="portfolio-loading">
                  Opening {isPortfolioView ? "portfolio" : "tool"}…
                </p>
              }
            >
              {currentView === "home" ? (
                <HomeLandingPage />
              ) : currentView === "photography" ? (
                <PhotographyPage />
              ) : currentView === "about" ? (
                <AboutPage />
              ) : currentView === "contact" ? (
                <ContactPage />
              ) : currentView === "work-gallery" ? (
                <WorkGallery
                  onOpenSettleUp={() => navigateToView("settle-up")}
                  onOpenCaptionTool={() => setIsAIOpen(true)}
                  onOpenFinanceTool={() => navigateToView("finance-dashboard")}
                  onOpenTradingAgentTool={() =>
                    navigateToView("trading-agent-dashboard")
                  }
                  onOpenSPXRecap={() => navigateToView("spx-recap")}
                  onOpenSPXGexHeatmap={() => navigateToView("spx-gex-heatmap")}
                  onOpenStocksWatcher={() =>
                    navigateToView("stocks-intelligence-watcher")
                  }
                  onOpenFixedIncome={() => navigateToView("fixed-income")}
                  onOpenMarketBreadth={() => navigateToView("market-breadth")}
                  onOpenPortfolioBacktest={() =>
                    navigateToView("portfolio-backtest")
                  }
                />
              ) : currentView === "settle-up" ? (
                <SettleUpPage
                  onBackToWork={() => navigateToView("work-gallery")}
                />
              ) : currentView === "finance-dashboard" ? (
                <FinanceDashboard
                  showChat={isFinanceChatOpen}
                  onCloseChat={() => setIsFinanceChatOpen(false)}
                />
              ) : currentView === "trading-agent-dashboard" ? (
                <TradingAgentDashboard />
              ) : currentView === "spx-recap" ? (
                <SPXRecapPage />
              ) : currentView === "spx-gex-heatmap" ? (
                <SPXGexHeatmapPage
                  onBackToWork={() => navigateToView("work-gallery")}
                />
              ) : currentView === "stocks-intelligence-watcher" ? (
                <StocksIntelligenceWatcherPage
                  onBackToWork={() => navigateToView("work-gallery")}
                />
              ) : currentView === "fixed-income" ? (
                <FixedIncomePage
                  onBackToWork={() => navigateToView("work-gallery")}
                />
              ) : currentView === "market-breadth" ? (
                <MarketBreadthPage
                  onBackToWork={() => navigateToView("work-gallery")}
                />
              ) : currentView === "portfolio-backtest" ? (
                <PortfolioBacktestPage
                  onBackToWork={() => navigateToView("work-gallery")}
                />
              ) : (
                <HomeLandingPage />
              )}
            </Suspense>
          </div>
        </div>
        {isAIOpen && (
          <Suspense fallback={null}>
            <AICaptionTool
              isOpen={isAIOpen}
              onClose={() => setIsAIOpen(false)}
            />
          </Suspense>
        )}

        {/* Grid Pattern Overlay */}
        {!isPortfolioView && !isFullScreenLabView && (
          <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:40px_40px]" />
        )}
      </main>
    </>
  );
}

export default App;
