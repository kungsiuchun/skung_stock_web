import { useState } from "react";
import { PortfolioFooter } from "./portfolio-footer";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  ImageIcon,
  Landmark,
  MessageSquare,
  ReceiptText,
  Users,
  Waves,
} from "lucide-react";

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
  onOpenPortfolioBacktest: () => void;
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
  onOpenPortfolioBacktest,
}: WorkGalleryProps) {
  const [filter, setFilter] = useState("All work");
  const workItems: WorkItem[] = [
    {
      title: "Settle Up",
      category: "Consumer Utility",
      description:
        "A modern bill-splitting app inspired by a real travel expense spreadsheet workflow.",
      buildNote:
        "Replicated the payer, participant, balance, and settlement logic as a live AI-built app.",
      action: "Open app",
      icon: <ReceiptText className="h-5 w-5" />,
      featured: true,
      onClick: onOpenSettleUp,
    },
    {
      title: "Finance Analyzer",
      category: "Market Agent",
      description:
        "An AI-powered dashboard for stock trend analysis, sentiment, VIX, and strategy signals.",
      buildNote:
        "Built as a full-stack agent interface around finance APIs and market interpretation tools.",
      action: "Open dashboard",
      icon: <MessageSquare className="h-5 w-5" />,
      onClick: onOpenFinanceTool,
    },
    {
      title: "Trading Agent",
      category: "Multi-role System",
      description:
        "A committee-style trading dashboard for technical signals and strategy context.",
      buildNote:
        "Explores how role-based AI agents can debate and structure trading decisions.",
      action: "Open agent",
      icon: <Users className="h-5 w-5" />,
      onClick: onOpenTradingAgentTool,
    },
    {
      title: "SPX Recap",
      category: "Audit Dashboard",
      description:
        "Review SPX callouts, defensive holds, and daily notes in an auditable timeline.",
      buildNote:
        "Turns trading bot output into a readable audit trail for faster review loops.",
      action: "Open recap",
      icon: <BarChart3 className="h-5 w-5" />,
      onClick: onOpenSPXRecap,
    },
    {
      title: "SPX GEX Heatmap",
      category: "Options Map",
      description:
        "Explore retained SPX NetGEX snapshots by strike, expiry, and trading session.",
      buildNote:
        "Automates the Stocks Intelligence workflow into a date-selectable gamma map without storing raw HTML.",
      action: "Open heatmap",
      icon: <Waves className="h-5 w-5" />,
      onClick: onOpenSPXGexHeatmap,
    },
    {
      title: "Stocks Intelligence Watcher",
      category: "Ticker Terminal",
      description:
        "A dense ticker watcher for quotes, favorites, options flow, OI, volume, and GEX by strike.",
      buildNote:
        "Built with AI agents around same-domain market APIs, published valuations, and explicitly labelled data sources.",
      action: "Open watcher",
      icon: <Activity className="h-5 w-5" />,
      featured: true,
      onClick: onOpenStocksWatcher,
    },
    {
      title: "Fixed Income",
      category: "Rates Terminal",
      description:
        "An official U.S. Treasury yield curve view across the latest, weekly, monthly, and year-start snapshots.",
      buildNote:
        "Uses Treasury's published par yield curve directly, with explicit curve dates and basis-point changes.",
      action: "Open rates",
      icon: <Landmark className="h-5 w-5" />,
      onClick: onOpenFixedIncome,
    },
    {
      title: "S&P 500 Market Breadth",
      category: "Market Internals",
      description:
        "A daily sector-level read of participation, leadership, and long-term trend strength across the SPY universe.",
      buildNote:
        "Rebuilds sector performance, constituent breadth, and SMA200 slope from licensed adjusted closes with explicit freshness and provenance.",
      action: "Open breadth",
      icon: <BarChart3 className="h-5 w-5" />,
      featured: true,
      onClick: onOpenMarketBreadth,
    },
    {
      title: "Portfolio vs SPY",
      category: "Portfolio Lab",
      description:
        "Build a US ETF allocation and compare its historical path with SPY under explicit dividend and rebalancing policies.",
      buildNote:
        "Uses server-side EOD simulation with visible source, effective dates, and fail-closed market-data states.",
      action: "Run backtest",
      icon: <BarChart3 className="h-5 w-5" />,
      featured: true,
      onClick: onOpenPortfolioBacktest,
    },
    {
      title: "Image Caption",
      category: "Vision Tool",
      description:
        "A compact image-to-caption utility using AI to describe uploaded visuals.",
      buildNote:
        "A small tool experiment in making AI perception visible inside the portfolio.",
      action: "Open tool",
      icon: <ImageIcon className="h-5 w-5" />,
      onClick: onOpenCaptionTool,
    },
  ];

  const priority = [
    "Stocks Intelligence Watcher",
    "SPX GEX Heatmap",
    "S&P 500 Market Breadth",
    "Portfolio vs SPY",
  ];
  const ordered = [...workItems].sort((a, b) => {
    const rank = (title: string) =>
      priority.includes(title) ? priority.indexOf(title) : priority.length;
    return rank(a.title) - rank(b.title);
  });
  const visible = ordered.filter(
    (item) =>
      filter === "All work" ||
      (filter === "Market tools"
        ? !["Settle Up", "Image Caption"].includes(item.title)
        : ["Settle Up", "Image Caption"].includes(item.title)),
  );
  return (
    <>
      <div className="portfolio-wrap">
        <header className="page-heading">
          <p className="eyebrow">01 / THE MARKET LAB & OTHER EXPERIMENTS</p>
          <h1>
            Working ideas.
            <br />
            <em>Real interfaces.</em>
          </h1>
          <div className="heading-bottom">
            <p>
              Tools I build and iterate on with AI agents. Mostly for exploring
              the stock market; sometimes for making everyday life simpler.
            </p>
            <span className="photo-count">10 TOOLS / OPEN & EXPLORE</span>
          </div>
        </header>
        <div className="filter-bar" role="group" aria-label="Filter projects">
          {["All work", "Market tools", "Everyday tools"].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {visible.length} projects shown
        </p>
        <div className="work-grid">
          {visible.map((item, index) => (
            <article
              className={
                index === 0 && filter !== "Everyday tools"
                  ? "work-card work-card-featured"
                  : "work-card"
              }
              key={item.title}
            >
              <div className="work-card-top">
                <div className="work-card-icon">
                  {item.icon}
                  <span className="eyebrow">
                    {String(ordered.indexOf(item) + 1).padStart(2, "0")}
                  </span>
                </div>
                <span className="eyebrow">{item.category}</span>
              </div>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
              <p className="work-contribution">
                <b>THE BUILD</b>
                {item.buildNote}
              </p>
              <button
                type="button"
                className="text-link"
                onClick={item.onClick}
                aria-label={item.action + ": " + item.title}
              >
                {item.action}
                <ArrowUpRight size={18} />
              </button>
            </article>
          ))}
        </div>
      </div>
      <PortfolioFooter />
    </>
  );
}
