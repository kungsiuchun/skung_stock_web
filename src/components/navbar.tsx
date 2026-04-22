import { portfolioConfig } from "@/config/portfolio";
import { Sparkles } from "lucide-react";

interface NavbarProps {
  onOpenAI: () => void;
  onHome?: () => void;
}

const Navbar = ({ onOpenAI, onHome }: NavbarProps) => {
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
          <a href="#" className="text-xs text-white/50 hover:text-white transition-colors uppercase tracking-widest font-medium">Work</a>
          <a href="#" className="text-xs text-white/50 hover:text-white transition-colors uppercase tracking-widest font-medium">About</a>
          <button 
            onClick={onOpenAI}
            className="flex items-center gap-2 text-xs text-purple-400 hover:text-purple-300 transition-colors uppercase tracking-widest font-bold group"
          >
            <Sparkles className="w-3 h-3 group-hover:animate-pulse" />
            AI Vision
          </button>
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
