import { useState } from 'react'
import DemoOne from './components/demo-one'
import Navbar from './components/navbar'
import AICaptionTool from './components/ai-caption-tool'
import FinanceChatTool from './components/finance-chat-tool'
import { FinanceDashboard } from './components/finance-dashboard'
import { FinRobotDashboard } from './components/dashboard/finrobot-dashboard'
import { TradingAgentDashboard } from './components/dashboard/trading-agent-dashboard'
import { AIFeaturesPage } from './components/ai-features-page'
import { portfolioConfig } from '@/config/portfolio'
import { Home, LineChart } from 'lucide-react'


export type ViewState = 'home' | 'ai-features' | 'finance-dashboard' | 'finrobot-dashboard' | 'trading-agent-dashboard';

function App() {
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isFinanceChatOpen, setIsFinanceChatOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>('home');

  return (
    <main className="w-full h-screen relative bg-[#141414] overflow-hidden">
      <Navbar 
        onOpenAI={() => setCurrentView('ai-features')} 
        onHome={() => setCurrentView('home')}
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
          ) : currentView === 'finance-dashboard' ? (
            <FinanceDashboard />
          ) : currentView === 'finrobot-dashboard' ? (
            <FinRobotDashboard />
          ) : currentView === 'trading-agent-dashboard' ? (
            <TradingAgentDashboard />
          ) : (
            <AIFeaturesPage 
              onOpenCaptionTool={() => setIsAIOpen(true)} 
              onOpenFinanceTool={() => setCurrentView('finance-dashboard')}
              onOpenFinRobotTool={() => setCurrentView('finrobot-dashboard')}
              onOpenTradingAgentTool={() => setCurrentView('trading-agent-dashboard')}
            />
          )}
        </div>
      </div>

      <AICaptionTool isOpen={isAIOpen} onClose={() => setIsAIOpen(false)} />
      <FinanceChatTool isOpen={isFinanceChatOpen} onClose={() => setIsFinanceChatOpen(false)} />

      {(currentView !== 'finance-dashboard' && currentView !== 'finrobot-dashboard' && currentView !== 'trading-agent-dashboard') && (
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
