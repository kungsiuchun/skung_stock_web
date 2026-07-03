import { portfolioConfig } from "@/config/portfolio";
import type { ViewState } from "@/lib/app-routes";

interface NavbarProps {
  onMarketLab: () => void;
  onPhotography: () => void;
  onHome?: () => void;
  onAbout: () => void;
  onContact: () => void;
  currentView: ViewState;
}

const labViews: ViewState[] = [
  "work-gallery",
  "settle-up",
  "finance-dashboard",
  "trading-agent-dashboard",
  "spx-recap",
  "spx-gex-heatmap",
  "stocks-intelligence-watcher",
];

const navItems = [
  { label: "Market Lab", key: "market-lab" },
  { label: "Photography", key: "photography" },
  { label: "About", key: "about" },
  { label: "Contact", key: "contact" },
] as const;

const getActiveKey = (currentView: ViewState) => {
  if (labViews.includes(currentView)) {
    return "market-lab";
  }

  return currentView;
};

const buttonClass = (active: boolean, editorial: boolean) =>
  [
    "relative font-mono text-[0.54rem] font-semibold uppercase tracking-[0.16em] transition-colors focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 sm:text-[0.68rem] sm:tracking-[0.32em]",
    editorial
      ? active
        ? "text-[#1a1714]"
        : "text-[#1a1714]/70 hover:text-[#1a1714]"
      : active
        ? "text-white"
        : "text-white/55 hover:text-white",
  ].join(" ");

const Navbar = ({
  onMarketLab,
  onPhotography,
  onHome,
  onAbout,
  onContact,
  currentView,
}: NavbarProps) => {
  const activeKey = getActiveKey(currentView);
  const editorial = currentView === "home" || currentView === "contact";
  const dividerClass = editorial ? "bg-[#c9c0b2]/80" : "bg-white/10";

  const handlers = {
    "market-lab": onMarketLab,
    photography: onPhotography,
    about: onAbout,
    contact: onContact,
  };

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-[100] px-5 pt-5 ${
        editorial ? "text-[#1a1714]" : "text-white"
      }`}
    >
      <div className={`mx-auto flex h-16 max-w-[calc(100vw-2.5rem)] items-center justify-between gap-4 border-b ${dividerClass} px-3 sm:px-10`}>
        <button
          type="button"
          onClick={onHome}
          className="shrink-0 font-serif text-2xl font-semibold tracking-[-0.04em] transition-opacity hover:opacity-70 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 sm:text-3xl"
        >
          {portfolioConfig.ownerName}
        </button>

        <nav className="flex min-w-0 items-center gap-3 sm:gap-9 lg:gap-14" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={handlers[item.key]}
              className={buttonClass(activeKey === item.key, editorial)}
            >
              {item.label}
            </button>
          ))}
          <span className="hidden h-2 w-2 rounded-full bg-[#e2632f] sm:inline-block" aria-hidden="true" />
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
