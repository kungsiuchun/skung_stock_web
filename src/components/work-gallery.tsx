import { useState } from "react";
import { PortfolioFooter } from "./portfolio-footer";
import {
  Activity,
  ArrowUpRight,
  ImageIcon,
  ReceiptText,
} from "lucide-react";
import { getHashForView, type ViewState } from "@/lib/app-routes";

interface WorkGalleryProps {
  onOpenCaptionTool: () => void;
}

type WorkItem = {
  title: string;
  category: string;
  description: string;
  buildNote: string;
  action: string;
  icon: React.ReactNode;
  featured?: boolean;
  view?: ViewState;
  onClick?: () => void;
};

export function WorkGallery({ onOpenCaptionTool }: WorkGalleryProps) {
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
      view: "settle-up",
    },
    {
      title: "Watcher",
      category: "Trading Workspace",
      description:
        "One research desk for your stocks, market context, options, evidence-based reports, and risk plans.",
      buildNote:
        "Built with AI agents around same-domain market APIs, published valuations, and explicitly labelled data sources.",
      action: "Open watcher",
      icon: <Activity className="h-5 w-5" />,
      featured: true,
      view: "stocks-intelligence-watcher",
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
    "Watcher",
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
            <span className="photo-count">{workItems.length} TOOLS / OPEN & EXPLORE</span>
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
              {item.view ? (
                <a className="text-link" href={getHashForView(item.view)} aria-label={item.action + ": " + item.title}>
                  {item.action}
                  <ArrowUpRight size={18} />
                </a>
              ) : (
                <button type="button" className="text-link" onClick={item.onClick} aria-label={item.action + ": " + item.title}>
                  {item.action}
                  <ArrowUpRight size={18} />
                </button>
              )}
            </article>
          ))}
        </div>
      </div>
      <PortfolioFooter />
    </>
  );
}
