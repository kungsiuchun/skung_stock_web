import { useEffect, useState } from 'react'
import DemoOne from './components/demo-one'
import Navbar from './components/navbar'
import AICaptionTool from './components/ai-caption-tool'
import FinanceChatTool from './components/finance-chat-tool'
import { FinanceDashboard } from './components/finance-dashboard'
import { TradingAgentDashboard } from './components/dashboard/trading-agent-dashboard'
import { SPXRecapPage } from './components/spx-recap-page'
import { SPXGexHeatmapPage } from './components/spx-gex-heatmap-page'
import { StocksIntelligenceWatcherPage } from './components/stocks-intelligence-watcher-page'
import { AboutPage } from './components/about-page'
import { WorkGallery } from './components/work-gallery'
import { SettleUpPage } from './components/settle-up-page'
import { portfolioConfig } from '@/config/portfolio'
import { Home, LineChart } from 'lucide-react'


export type ViewState = 'home' | 'about' | 'work-gallery' | 'settle-up' | 'finance-dashboard' | 'trading-agent-dashboard' | 'spx-recap' | 'spx-gex-heatmap' | 'stocks-intelligence-watcher';

const getViewFromHash = (): ViewState | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const hash = window.location.hash;

  if (hash.startsWith('#/work/settle-up')) {
    return 'settle-up';
  }

  if (hash.startsWith('#/work/spx-gex-heatmap')) {
    return 'spx-gex-heatmap';
  }

  if (hash.startsWith('#/work/trading-agent-dashboard')) {
    return 'trading-agent-dashboard';
  }

  if (hash.startsWith('#/work/stocks-intelligence-watcher')) {
    return 'stocks-intelligence-watcher';
  }

  if (hash.startsWith('#/work')) {
    return 'work-gallery';
  }

  return null;
};

function App() {
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isFinanceChatOpen, setIsFinanceChatOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>('home');

  useEffect(() => {
    const syncViewFromHash = () => {
      const hashView = getViewFromHash();

      if (hashView) {
        setCurrentView(hashView);
      }
    };

    syncViewFromHash();
    window.addEventListener('hashchange', syncViewFromHash);

    return () => window.removeEventListener('hashchange', syncViewFromHash);
  }, []);

  const navigateToView = (view: ViewState) => {
    setCurrentView(view);

    if (typeof window === 'undefined') {
      return;
    }

    if (view === 'work-gallery') {
      window.location.hash = '#/work';
      return;
    }

    if (view === 'settle-up') {
      window.location.hash = '#/work/settle-up';
      return;
    }

    if (view === 'spx-gex-heatmap') {
      window.location.hash = '#/work/spx-gex-heatmap';
      return;
    }

    if (view === 'trading-agent-dashboard') {
      window.location.hash = '#/work/trading-agent-dashboard';
      return;
    }

    if (view === 'stocks-intelligence-watcher') {
      window.location.hash = '#/work/stocks-intelligence-watcher';
      return;
    }

    if (window.location.hash.startsWith('#/work')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };

  return (
    <main className="w-full h-screen relative bg-[#141414] overflow-hidden">
      <Navbar 
        onWork={() => navigateToView('work-gallery')}
        onHome={() => navigateToView('home')}
        onAbout={() => navigateToView('about')}
        currentView={currentView}
      />
      
      <div className="w-full h-full flex pt-20">
        
        {/* Left App Navigation Component - ONLY active during Finance Dashboard */}
        {currentView === 'finance-dashboard' && (
          <div className="w-16 h-full flex flex-col items-center py-8 border-r border-white/5 bg-[#0a0f16] z-50 shrink-0">
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


        <div className="flex-1 h-full overflow-hidden">
          {currentView === 'home' ? (
            <DemoOne />
          ) : currentView === 'about' ? (
            <AboutPage />
          ) : currentView === 'work-gallery' ? (
            <WorkGallery
              onOpenSettleUp={() => navigateToView('settle-up')}
              onOpenCaptionTool={() => setIsAIOpen(true)}
              onOpenFinanceTool={() => navigateToView('finance-dashboard')}
              onOpenTradingAgentTool={() => navigateToView('trading-agent-dashboard')}
              onOpenSPXRecap={() => navigateToView('spx-recap')}
              onOpenSPXGexHeatmap={() => navigateToView('spx-gex-heatmap')}
              onOpenStocksWatcher={() => navigateToView('stocks-intelligence-watcher')}
            />
          ) : currentView === 'settle-up' ? (
            <SettleUpPage onBackToWork={() => navigateToView('work-gallery')} />
          ) : currentView === 'finance-dashboard' ? (
            <FinanceDashboard />
          ) : currentView === 'trading-agent-dashboard' ? (
            <TradingAgentDashboard />
          ) : currentView === 'spx-recap' ? (
            <SPXRecapPage />
          ) : currentView === 'spx-gex-heatmap' ? (
            <SPXGexHeatmapPage onBackToWork={() => navigateToView('work-gallery')} />
          ) : currentView === 'stocks-intelligence-watcher' ? (
            <StocksIntelligenceWatcherPage onBackToWork={() => navigateToView('work-gallery')} />
          ) : (
            <DemoOne />
          )}
        </div>
      </div>

      <AICaptionTool isOpen={isAIOpen} onClose={() => setIsAIOpen(false)} />
      <FinanceChatTool isOpen={isFinanceChatOpen} onClose={() => setIsFinanceChatOpen(false)} />

      {currentView === 'home' && (
        <div className="fixed bottom-12 left-28 z-50 pointer-events-none">
        <h1 className="text-6xl font-black text-white/95 tracking-tighter leading-none mix-blend-difference">
          {portfolioConfig.ownerName.toUpperCase()}'S<br/>
          <span className="text-white/40">PORTFOLIO</span>
        </h1>
        <div className="flex items-center gap-4 mt-6">
          <div className="w-12 h-[1px] bg-white/30" />
          <p className="text-white/40 text-xs font-mono uppercase tracking-[0.3em]">
            Curated Visual Experience
          </p>
        </div>
      </div>
      )}

      {/* Grid Pattern Overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:40px_40px]" />
    </main>
  )
}

export default App
