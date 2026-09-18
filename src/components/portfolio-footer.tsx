import { ArrowUpRight } from "lucide-react";

export function PortfolioFooter() {
  return (
    <footer className="portfolio-footer">
      <div className="portfolio-wrap">
        <div className="footer-top">
          <a href="#/contact">
            Good things start
            <br />
            with a <em>conversation.</em> <ArrowUpRight aria-hidden="true" />
          </a>
          <p>
            Code, markets & the world outside.
            <br />A personal collection by Siu.
          </p>
        </div>
        <div className="footer-bottom">
          <a href="#/" className="wordmark">
            Siu<span>.</span>
          </a>
          <span>BUILT WITH CURIOSITY. FRAMED WITH INTENTION.</span>
          <a href="#/about">
            About & résumé <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </footer>
  );
}
