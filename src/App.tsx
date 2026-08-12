import { useEffect, useState } from 'react'
import DemoOne from './components/demo-one'
import Navbar from './components/navbar'
import AICaptionTool from './components/ai-caption-tool'
import { HomeLandingPage } from './components/home-landing-page'
import { FinanceDashboard } from './components/finance-dashboard'
import { TradingAgentDashboard } from './components/dashboard/trading-agent-dashboard'
import { SPXRecapPage } from './components/spx-recap-page'
import { SPXGexHeatmapPage } from './components/spx-gex-heatmap-page'
import { StocksIntelligenceWatcherPage } from './components/stocks-intelligence-watcher-page'
import { FixedIncomePage } from './components/fixed-income-page'
import { AboutPage } from './components/about-page'
import { ContactPage } from './components/contact-page'
import { WorkGallery } from './components/work-gallery'
import { SettleUpPage } from './components/settle-up-page'
import { getHashForView, getViewFromHash, type ViewState } from '@/lib/app-routes'
import { ArrowLeft, Home, LineChart } from 'lucide-react'

function App() {
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isFinanceChatOpen, setIsFinanceChatOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>(() =>
    typeof window === 'undefined' ? 'home' : getViewFromHash(window.location.hash)
  );
  const isFullScreenLabView = [
    'finance-dashboard',
    'spx-gex-heatmap',
    'stocks-intelligence-watcher',
    'fixed-income',
  ].includes(currentView);

  useEffect(() => {
    const syncViewFromHash = () => {
      setCurrentView(getViewFromHash(window.location.hash));
    };

    syncViewFromHash();
    window.addEventListener('hashchange', syncViewFromHash);

    return () => window.removeEventListener('hashchange', syncViewFromHash);
  }, []);

  const navigateToView = (view: ViewState) => {
    if (typeof window === 'undefined') {
      return;
    }

    window.location.hash = getHashForView(view);
  };

  return (
    <main className="relative min-h-dvh w-full overflow-visible bg-[#141414] lg:h-screen lg:overflow-hidden">
      {!isFullScreenLabView && (
        <Navbar
          onMarketLab={() => navigateToView('work-gallery')}
          onPhotography={() => navigateToView('photography')}
          onHome={() => navigateToView('home')}
          onAbout={() => navigateToView('about')}
          onContact={() => navigateToView('contact')}
          currentView={currentView}
        />
      )}
      
      <div className={`flex min-h-dvh w-full overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden ${currentView === 'home' || currentView === 'contact' || isFullScreenLabView ? '' : 'pt-20'}`}>
        
        {/* Left App Navigation Component - ONLY active during Finance Dashboard */}
        {currentView === 'finance-dashboard' && (
          <div className="w-16 h-full flex flex-col items-center py-8 border-r border-white/5 bg-[#0a0f16] z-50 shrink-0">
            <button
              type="button"
              title="Back to Market Lab"
              aria-label="Back to Market Lab"
              onClick={() => navigateToView('work-gallery')}
              className="mb-5 rounded-lg border border-white/10 p-3 text-white/60 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-300"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex flex-col gap-4 bg-white/5 rounded-full p-2 border border-white/10 shadow-xl">
               <button title="Dashboard view" onClick={() => { setIsFinanceChatOpen(false); }} className={`p-3 rounded-full transition-colors ${!isFinanceChatOpen ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/50 hover:text-white'}`}>
                  <Home className="w-5 h-5" />
               </button>
               <button title="Analyzer (Chat Bot)" onClick={() => setIsFinanceChatOpen(true)} className={`p-3 rounded-full transition-colors ${isFinanceChatOpen ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/50 hover:text-white'}`}>
                  <LineChart className="w-5 h-5" />
               </button>
            </div>
          </div>
        )}


        <div className="min-w-0 flex-1 overflow-visible lg:h-full lg:overflow-hidden">
          {currentView === 'home' ? (
            <HomeLandingPage
              onOpenMarketLab={() => navigateToView('work-gallery')}
              onOpenPhotography={() => navigateToView('photography')}
            />
          ) : currentView === 'photography' ? (
            <DemoOne />
          ) : currentView === 'about' ? (
            <AboutPage />
          ) : currentView === 'contact' ? (
            <ContactPage />
          ) : currentView === 'work-gallery' ? (
            <WorkGallery
              onOpenSettleUp={() => navigateToView('settle-up')}
              onOpenCaptionTool={() => setIsAIOpen(true)}
              onOpenFinanceTool={() => navigateToView('finance-dashboard')}
              onOpenTradingAgentTool={() => navigateToView('trading-agent-dashboard')}
              onOpenSPXRecap={() => navigateToView('spx-recap')}
              onOpenSPXGexHeatmap={() => navigateToView('spx-gex-heatmap')}
              onOpenStocksWatcher={() => navigateToView('stocks-intelligence-watcher')}
              onOpenFixedIncome={() => navigateToView('fixed-income')}
            />
          ) : currentView === 'settle-up' ? (
            <SettleUpPage onBackToWork={() => navigateToView('work-gallery')} />
          ) : currentView === 'finance-dashboard' ? (
            <FinanceDashboard
              showChat={isFinanceChatOpen}
              onCloseChat={() => setIsFinanceChatOpen(false)}
            />
          ) : currentView === 'trading-agent-dashboard' ? (
            <TradingAgentDashboard />
          ) : currentView === 'spx-recap' ? (
            <SPXRecapPage />
          ) : currentView === 'spx-gex-heatmap' ? (
            <SPXGexHeatmapPage onBackToWork={() => navigateToView('work-gallery')} />
          ) : currentView === 'stocks-intelligence-watcher' ? (
            <StocksIntelligenceWatcherPage onBackToWork={() => navigateToView('work-gallery')} />
          ) : currentView === 'fixed-income' ? (
            <FixedIncomePage onBackToWork={() => navigateToView('work-gallery')} />
          ) : (
            <HomeLandingPage
              onOpenMarketLab={() => navigateToView('work-gallery')}
              onOpenPhotography={() => navigateToView('photography')}
            />
          )}
        </div>
      </div>

      <AICaptionTool isOpen={isAIOpen} onClose={() => setIsAIOpen(false)} />

      {/* Grid Pattern Overlay */}
      {currentView !== 'home' && currentView !== 'contact' && !isFullScreenLabView && (
        <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:40px_40px]" />
      )}
    </main>
  )
}

export default App
