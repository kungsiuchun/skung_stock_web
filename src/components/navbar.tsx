import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import type { ViewState } from "@/lib/app-routes";

const links = [
  { title: "Market Lab", href: "#/market-lab", view: "work-gallery" },
  { title: "Photography", href: "#/photography", view: "photography" },
  { title: "About & résumé", href: "#/about", view: "about" },
  { title: "Contact", href: "#/contact", view: "contact" },
];
export default function Navbar({ currentView }: { currentView: ViewState }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const portfolio = [
    "home",
    "work-gallery",
    "photography",
    "about",
    "contact",
  ].includes(currentView);
  useEffect(() => {
    setOpen(false);
  }, [currentView]);
  return (
    <header
      className={`portfolio-nav ${portfolio ? "" : "portfolio-nav-dark"}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <div className="portfolio-wrap nav-inner">
        <a className="brand" href="#/" aria-label="Siu home">
          <span className="wordmark">
            Siu<span>.</span>
          </span>
          <span className="brand-caption">
            CODE &<br />
            CAMERA
          </span>
        </a>
        <button
          ref={toggleRef}
          className="mobile-menu-toggle"
          type="button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-controls="portfolio-navigation"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
        <nav
          id="portfolio-navigation"
          className={open ? "nav-links is-open" : "nav-links"}
          aria-label="Primary navigation"
        >
          {links.map((link) => (
            <a
              key={link.view}
              href={link.href}
              onClick={() => setOpen(false)}
              aria-current={
                currentView === link.view ||
                (!portfolio && link.view === "work-gallery")
                  ? "page"
                  : undefined
              }
            >
              {link.title}
              {link.view === "contact" && <ArrowUpRight size={15} />}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
