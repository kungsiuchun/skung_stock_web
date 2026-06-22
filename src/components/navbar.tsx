import { portfolioConfig } from "@/config/portfolio";
import type { ViewState } from "@/lib/app-routes";

interface NavbarProps {
  onWork: () => void;
  onHome?: () => void;
  onAbout: () => void;
  currentView: ViewState;
}

const navTextClass = (active: boolean) =>
  `text-xs transition-colors uppercase tracking-widest font-medium ${
    active ? 'text-white' : 'text-white/50 hover:text-white'
  }`;

const Navbar = ({ onWork, onHome, onAbout, currentView }: NavbarProps) => {
  const callApi = async () => {
    try {
      const response = await fetch('/api/hello');
      const text = await response.text();
      alert(`Backend Result: ${text}`);
    } catch (error) {
      console.error('API call failed:', error);
      alert('Backend call failed. Note: Functions only work when deployed to Cloudflare via Git or Wrangler.');
    }
  };

  const isWorkActive = [
    'work-gallery',
    'settle-up',
    'finance-dashboard',
    'trading-agent-dashboard',
    'spx-recap',
    'spx-gex-heatmap',
    'stocks-intelligence-watcher',
  ].includes(currentView);

  return (
    <nav className="fixed top-0 left-0 right-0 z-[100] px-6 py-4 flex items-center justify-between pointer-events-auto">
      <div className="flex items-center gap-4 bg-black/20 backdrop-blur-md border border-white/10 px-6 py-2 rounded-full shadow-2xl">
        <button 
          onClick={onHome}
          className="text-white font-bold tracking-tighter text-xl hover:text-white/80 transition-colors"
        >
          {portfolioConfig.ownerName.toUpperCase()}'S
        </button>
        <div className="h-4 w-[1px] bg-white/20 mx-2" />
        <div className="flex items-center gap-6">
          <button onClick={onWork} className={navTextClass(isWorkActive)}>Work</button>
          <button onClick={onAbout} className={navTextClass(currentView === 'about')}>About</button>
        </div>
      </div>
      
      <div 
        onClick={callApi}
        className="bg-white text-black px-6 py-2 rounded-full font-bold text-xs uppercase tracking-widest shadow-2xl hover:scale-105 transition-transform cursor-pointer"
      >
        Let's Talk
      </div>
    </nav>
  );
};

export default Navbar;
