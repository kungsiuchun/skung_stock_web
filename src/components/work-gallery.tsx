import { Activity, ArrowRight, BarChart3, Camera, CircleDollarSign, ImageIcon, Landmark, MessageSquare, ReceiptText, Users, Waves } from "lucide-react";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { cn } from "@/lib/utils";

interface WorkGalleryProps {
  onOpenSettleUp: () => void;
  onOpenCaptionTool: () => void;
  onOpenFinanceTool: () => void;
  onOpenTradingAgentTool: () => void;
  onOpenSPXRecap: () => void;
  onOpenSPXGexHeatmap: () => void;
  onOpenStocksWatcher: () => void;
  onOpenFixedIncome: () => void;
  onOpenMarketBreadth: () => void;
}

type WorkItem = {
  title: string;
  category: string;
  description: string;
  buildNote: string;
  action: string;
  icon: React.ReactNode;
  featured?: boolean;
  onClick: () => void;
};

export function WorkGallery({
  onOpenSettleUp,
  onOpenCaptionTool,
  onOpenFinanceTool,
  onOpenTradingAgentTool,
  onOpenSPXRecap,
  onOpenSPXGexHeatmap,
  onOpenStocksWatcher,
  onOpenFixedIncome,
  onOpenMarketBreadth,
}: WorkGalleryProps) {
  const workItems: WorkItem[] = [
    {
      title: "Settle Up",
      category: "Consumer Utility",
      description: "A modern bill-splitting app inspired by a real travel expense spreadsheet workflow.",
      buildNote: "Replicated the payer, participant, balance, and settlement logic as a live AI-built app.",
      action: "Open app",
      icon: <ReceiptText className="h-5 w-5" />,
      featured: true,
      onClick: onOpenSettleUp,
    },
    {
      title: "Finance Analyzer",
      category: "Market Agent",
      description: "An AI-powered dashboard for stock trend analysis, sentiment, VIX, and strategy signals.",
      buildNote: "Built as a full-stack agent interface around finance APIs and market interpretation tools.",
      action: "Open dashboard",
      icon: <MessageSquare className="h-5 w-5" />,
      onClick: onOpenFinanceTool,
    },
    {
      title: "Trading Agent",
      category: "Multi-role System",
      description: "A committee-style trading dashboard for technical signals and strategy context.",
      buildNote: "Explores how role-based AI agents can debate and structure trading decisions.",
      action: "Open agent",
      icon: <Users className="h-5 w-5" />,
      onClick: onOpenTradingAgentTool,
    },
    {
      title: "SPX Recap",
      category: "Audit Dashboard",
      description: "A recap view for SPX callouts, defensive holds, daily notes, and PnL review.",
      buildNote: "Turns trading bot output into a readable audit trail for faster review loops.",
      action: "Open recap",
      icon: <BarChart3 className="h-5 w-5" />,
      onClick: onOpenSPXRecap,
    },
    {
      title: "SPX GEX Heatmap",
      category: "Options Map",
      description: "A retained seven-trading-day view of premarket SPX NetGEX by strike and expiry.",
      buildNote: "Automates the Stocks Intelligence workflow into a date-selectable gamma map without storing raw HTML.",
      action: "Open heatmap",
      icon: <Waves className="h-5 w-5" />,
      onClick: onOpenSPXGexHeatmap,
    },
    {
      title: "Stocks Intelligence Watcher",
      category: "Ticker Terminal",
      description: "A dense ticker watcher for quotes, favorites, options flow, OI, volume, and GEX by strike.",
      buildNote: "Replicates the Stocks Intelligence workflow as a live portfolio product backed by the MCP server.",
      action: "Open watcher",
      icon: <Activity className="h-5 w-5" />,
      featured: true,
      onClick: onOpenStocksWatcher,
    },
    {
      title: "Fixed Income",
      category: "Rates Terminal",
      description: "An official U.S. Treasury yield curve view across the latest, weekly, monthly, and year-start snapshots.",
      buildNote: "Uses Treasury's published par yield curve directly, with explicit curve dates and basis-point changes.",
      action: "Open rates",
      icon: <Landmark className="h-5 w-5" />,
      onClick: onOpenFixedIncome,
    },
    {
      title: "S&P 500 Market Breadth",
      category: "Market Internals",
      description: "A daily sector-level read of participation, leadership, and long-term trend strength across the SPY universe.",
      buildNote: "Rebuilds sector performance, constituent breadth, and SMA200 slope from licensed adjusted closes with explicit freshness and provenance.",
      action: "Open breadth",
      icon: <BarChart3 className="h-5 w-5" />,
      featured: true,
      onClick: onOpenMarketBreadth,
    },
    {
      title: "Image Caption",
      category: "Vision Tool",
      description: "A compact image-to-caption utility using AI to describe uploaded visuals.",
      buildNote: "A small tool experiment in making AI perception visible inside the portfolio.",
      action: "Open tool",
      icon: <ImageIcon className="h-5 w-5" />,
      onClick: onOpenCaptionTool,
    },
  ];

  return (
    <section className="h-full w-full overflow-y-auto px-6 pb-12 pt-10 text-white sm:px-10 lg:px-14">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">
              <CircleDollarSign className="h-3.5 w-3.5" />
              AI-built app gallery
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white md:text-6xl">
              Work that behaves like product.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/60">
              A collection of apps and systems rebuilt with AI agents, shaped into working demos instead of static case studies.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-white/40">
            <Camera className="h-4 w-4" />
            <span>Live demos first, build notes second.</span>
          </div>
        </header>

        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {workItems.map((item) => (
            <WorkCard key={item.title} item={item} />
          ))}
        </ul>
      </div>
    </section>
  );
}

const WorkCard = ({ item }: { item: WorkItem }) => {
  return (
    <li className={cn("min-h-[16rem] list-none", item.featured && "lg:col-span-2")}>
      <button
        onClick={item.onClick}
        className="group h-full w-full cursor-pointer text-left transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-emerald-300/70"
      >
        <div className="relative h-full rounded-[1.25rem] border-[0.75px] border-white/10 bg-black/20 p-2 md:rounded-[1.5rem] md:p-3">
          <GlowingEffect
            spread={40}
            glow={true}
            disabled={false}
            proximity={64}
            inactiveZone={0.01}
            borderWidth={3}
          />
          <div className="relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-xl border-[0.75px] border-white/10 bg-black/40 p-6 shadow-sm backdrop-blur-sm transition-colors hover:bg-black/60 dark:shadow-[0px_0px_27px_0px_rgba(45,45,45,0.3)] md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border-[0.75px] border-white/20 bg-white/10 text-white">
                {item.icon}
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-white/50">
                {item.category}
              </span>
            </div>

            <div className="flex flex-1 flex-col justify-end gap-4">
              <div>
                <h2 className="pt-0.5 text-2xl font-semibold leading-[1.875rem] tracking-normal text-balance text-white md:text-3xl">
                  {item.title}
                </h2>
                <p className="mt-3 text-sm leading-6 text-white/60">{item.description}</p>
              </div>
              <p className="border-l border-emerald-300/40 pl-4 text-sm leading-6 text-emerald-50/70">
                {item.buildNote}
              </p>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-5 text-sm font-bold uppercase tracking-[0.16em] text-white/60">
              <span>{item.action}</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </div>
      </button>
    </li>
  );
};
