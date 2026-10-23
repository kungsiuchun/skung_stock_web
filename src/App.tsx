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
const SectorRotationPage = lazy(() =>
  import("./components/sector-rotation-page").then((module) => ({
    default: module.SectorRotationPage,
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
  getTitleForView,
  getViewFromHash,
  type ViewState,
} from "@/lib/app-routes";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import { ArrowLeft, Home, LineChart } from "lucide-react";

function App() {
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isFinanceChatOpen, setIsFinanceChatOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>(() =>
    typeof window === "undefined"
      ? "home"
      : getViewFromHash(window.location.hash),
  );
  const [currentHash, setCurrentHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash,
  );
  const isPortfolioView = [
    "home",
    "about",
    "contact",
    "photography",
    "work-gallery",
  ].includes(currentView);
  const contentRef = useRef<HTMLDivElement>(null);
  const captionOpenerRef = useRef<HTMLElement | null>(null);
  const closeCaptionTool = () => {
    setIsAIOpen(false);
    captionOpenerRef.current?.focus();
  };
  const previousView = useRef(currentView);
  useEffect(() => {
    document.title = getTitleForView(currentView);
    if (previousView.current !== currentView) {
      window.scrollTo({ top: 0, behavior: "instant" });
      setIsAIOpen(false);
      contentRef.current?.focus({ preventScroll: true });
      previousView.current = currentView;
    }
  }, [currentView]);
  const isFullScreenLabView = [
    "finance-dashboard",
    "spx-gex-heatmap",
    "stocks-intelligence-watcher",
    "fixed-income",
    "market-breadth",
    "sector-rotation",
    "portfolio-backtest",
  ].includes(currentView);

  useEffect(() => {
    const syncViewFromHash = () => {
      const hash = window.location.hash;
      setCurrentHash(hash);
      setCurrentView(getViewFromHash(hash));
    };

    syncViewFromHash();
    window.addEventListener("hashchange", syncViewFromHash);

    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  return (
    <>
      <button className="skip-link" onClick={() => contentRef.current?.focus()}>
        Skip to content
      </button>
      <main
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
              <a
                title="Back to Market Lab"
                aria-label="Back to Market Lab"
                href={getHashForView("work-gallery")}
                className="mb-5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/10 p-3 text-white/60 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-300"
              >
                <ArrowLeft className="w-5 h-5" />
              </a>
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
            id="page-content"
            ref={contentRef}
            tabIndex={-1}
            className={
              isPortfolioView
                ? "portfolio-content"
                : "min-w-0 flex-1 overflow-visible lg:h-full lg:overflow-hidden"
            }
          >
            <RouteErrorBoundary routeKey={currentHash}>
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
                <WorkGallery onOpenCaptionTool={() => {
                  captionOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                  setIsAIOpen(true);
                }} />
              ) : currentView === "settle-up" ? (
                <SettleUpPage />
              ) : currentView === "finance-dashboard" ? (
                <FinanceDashboard
                  showChat={isFinanceChatOpen}
                  onOpenChat={() => setIsFinanceChatOpen(true)}
                  onCloseChat={() => setIsFinanceChatOpen(false)}
                />
              ) : currentView === "trading-agent-dashboard" ? (
                <TradingAgentDashboard />
              ) : currentView === "spx-recap" ? (
                <SPXRecapPage />
              ) : currentView === "spx-gex-heatmap" ? (
                <SPXGexHeatmapPage />
              ) : currentView === "stocks-intelligence-watcher" ? (
                <StocksIntelligenceWatcherPage />
              ) : currentView === "fixed-income" ? (
                <FixedIncomePage />
              ) : currentView === "market-breadth" ? (
                <MarketBreadthPage />
              ) : currentView === "sector-rotation" ? (
                <SectorRotationPage />
              ) : currentView === "portfolio-backtest" ? (
                <PortfolioBacktestPage />
              ) : (
                <HomeLandingPage />
              )}
              </Suspense>
            </RouteErrorBoundary>
          </div>
        </div>
        {isAIOpen && currentView === "work-gallery" && (
          <RouteErrorBoundary routeKey="image-caption" fallback={
            <section role="alert" className="flex min-h-[60vh] items-center justify-center bg-[#0d0f10] p-6 text-zinc-100">
              <div className="max-w-lg border border-rose-500/50 p-6">
                <h2 className="text-2xl font-bold">Image Caption could not open.</h2>
                <p className="mt-3 text-sm leading-6">Your gallery is still available. Reload this page to try Image Caption again, or close this message.</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" onClick={() => window.location.reload()} className="min-h-11 border border-zinc-600 px-4">Reload page</button>
                  <button type="button" aria-label="Close Image Caption error" ref={(node) => node?.focus()} onClick={closeCaptionTool} className="min-h-11 border border-rose-300 px-4">Close message</button>
                </div>
              </div>
            </section>
          }>
            <Suspense fallback={
              <div role="status" className="fixed bottom-[calc(1rem_+_env(safe-area-inset-bottom))] left-4 right-4 z-[110] flex flex-wrap items-center justify-between gap-4 border border-[#d5d1c7] bg-[#f4f0e8] p-4 text-[#252620] shadow-lg">
                <p>Opening Image Caption…</p>
                <button type="button" aria-label="Cancel opening Image Caption" onClick={closeCaptionTool} className="min-h-11 border border-current px-4">Cancel opening</button>
              </div>
            }>
              <AICaptionTool isOpen={isAIOpen} onClose={closeCaptionTool} />
            </Suspense>
          </RouteErrorBoundary>
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
