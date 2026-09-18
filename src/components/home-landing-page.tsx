import { useState } from "react";
import { ArrowDown, ArrowUpRight, Pause, Play } from "lucide-react";
import { ParticlePortraitCanvas } from "./particle-portrait-canvas";
import { PortfolioFooter } from "./portfolio-footer";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export function HomeLandingPage() {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  return (
    <div className="portfolio-home">
      <section
        className="portfolio-hero portfolio-wrap"
        aria-labelledby="home-title"
      >
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="accent-dot" /> DATA ANALYST · CREATIVE DEVELOPER
          </p>
          <h1 id="home-title">
            Finding signal.
            <br />
            <em>Framing stories.</em>
          </h1>
          <p className="hero-intro">
            I’m Siu. I build stock research tools with AI agents, make sense of
            data, and take the scenic route with my camera.
          </p>
          <div className="hero-actions">
            <a className="portfolio-button" href="#/market-lab">
              Explore my work <ArrowUpRight size={18} />
            </a>
            <a className="text-link" href="#/about">
              About & résumé <ArrowUpRight size={17} />
            </a>
          </div>
          <p className="hero-signature">用 code 做工具，用鏡頭記錄世界。</p>
        </div>
        <figure className="hero-portrait">
          <span className="portrait-index eyebrow" aria-hidden="true">
            FIG. 01 / THE PERSON BEHIND THE PIXELS
          </span>
          <ParticlePortraitCanvas
            src="/image/siu-hero.webp"
            alt="Siu, rendered as an ink and burnt-orange particle portrait"
            animate={!paused && !reducedMotion}
            className="portrait-canvas"
          />
          <figcaption className="portrait-caption">
            <span>
              SIUCHUN WILSON KUNG <span className="muted">/ SIU</span>
            </span>
            {!reducedMotion && (
              <button
                type="button"
                onClick={() => setPaused(!paused)}
                aria-label={
                  paused
                    ? "Play portrait animation"
                    : "Pause portrait animation"
                }
              >
                {paused ? <Play size={14} /> : <Pause size={14} />}
                <span>{paused ? "Play motion" : "Pause motion"}</span>
              </button>
            )}
          </figcaption>
        </figure>
      </section>
      <nav
        className="home-paths portfolio-wrap"
        aria-label="Explore the portfolio"
      >
        {[
          [
            "01",
            "Market Lab",
            "AI-built tools, ready to explore.",
            "#/market-lab",
          ],
          [
            "02",
            "Photography",
            "People, places & the in-between.",
            "#/photography",
          ],
          [
            "03",
            "About & résumé",
            "The experience behind the work.",
            "#/about",
          ],
        ].map(([number, title, subtitle, href]) => (
          <a href={href} key={number}>
            <span className="eyebrow path-number">{number}</span>
            <div>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
            <ArrowUpRight size={23} />
          </a>
        ))}
      </nav>
      <section className="portfolio-section portfolio-wrap">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 / CODE & CURIOSITY</p>
            <h2>
              Ideas you can <em>use.</em>
            </h2>
          </div>
          <a className="text-link" href="#/market-lab">
            All tools <ArrowUpRight size={18} />
          </a>
        </div>
        <div className="selected-work">
          <a
            className="selected-work-lead"
            href="#/work/stocks-intelligence-watcher"
          >
            <div className="work-cover">
              <span className="eyebrow">STOCKS INTELLIGENCE</span>
              <span className="cover-word">
                Watcher<span>↗</span>
              </span>
              <div className="cover-topics">
                <span>Watchlist</span>
                <span>Financials</span>
                <span>Options</span>
              </div>
              <span className="cover-note">
                A research workspace. Built with AI.
              </span>
            </div>
            <div className="selected-work-caption">
              <div>
                <h3>Stocks Intelligence Watcher</h3>
                <p>
                  Quotes, company financials and options in one research
                  workflow.
                </p>
              </div>
              <ArrowUpRight />
            </div>
          </a>
          <div className="selected-work-list">
            <a href="#/work/market-breadth">
              <span className="eyebrow">MARKET INTERNALS</span>
              <h3>
                See beyond
                <br />
                the index.
              </h3>
              <p>
                S&P 500 Market Breadth — explore sector leadership and
                participation.
              </p>
              <span className="text-link">
                Explore breadth <ArrowUpRight size={18} />
              </span>
            </a>
            <a href="#/work/portfolio-backtest">
              <span className="eyebrow">PORTFOLIO RESEARCH</span>
              <h3>
                Put an allocation
                <br />
                in perspective.
              </h3>
              <p>
                Portfolio vs SPY — compare historical ETF allocations with
                explicit assumptions.
              </p>
              <span className="text-link">
                Open backtester <ArrowUpRight size={18} />
              </span>
            </a>
          </div>
        </div>
      </section>
      <section className="home-photography">
        <div className="portfolio-wrap portfolio-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">02 / AWAY FROM THE SCREEN</p>
              <h2>
                A different kind
                <br />
                of <em>attention.</em>
              </h2>
            </div>
            <div>
              <p className="section-description">
                Travel photographs. Small details.
                <br />A reason to look a little longer.
              </p>
              <a className="text-link" href="#/photography">
                Enter the photo journal <ArrowUpRight size={18} />
              </a>
            </div>
          </div>
          <a
            className="photo-pair"
            href="#/photography"
            aria-label="Explore Siu’s travel photography"
          >
            <figure>
              <img
                src="/image/DSC_0395.JPG"
                alt="Chicago skyline reflected on the river at dusk"
                width="1920"
                height="1280"
                loading="lazy"
              />
              <figcaption>CHICAGO / AFTER THE LIGHT CHANGES</figcaption>
            </figure>
            <figure>
              <img
                src="/image/DSC_0990.JPG"
                alt="Garden portrait with a straw hat"
                width="1280"
                height="1920"
                loading="lazy"
              />
              <figcaption>TRAVEL JOURNAL / A MOMENT BETWEEN PLACES</figcaption>
            </figure>
          </a>
        </div>
      </section>
      <section className="home-about portfolio-wrap portfolio-section">
        <p className="eyebrow">03 / THE THROUGH LINE</p>
        <div>
          <h2>
            Analytical by training.
            <br />
            <em>Curious by nature.</em>
          </h2>
          <p>
            Data Analyst at Canvas Worldwide. A computer science background, a
            hands-on approach to AI, and a habit of turning questions into
            working tools.
          </p>
          <a href="#/about" className="text-link">
            Get to know me <ArrowUpRight size={18} />
          </a>
        </div>
        <ArrowDown
          className="home-about-arrow"
          size={50}
          strokeWidth={1}
          aria-hidden="true"
        />
      </section>
      <PortfolioFooter />
    </div>
  );
}
