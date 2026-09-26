import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { HomeLandingPage } from "../src/components/home-landing-page";
import { AboutPage } from "../src/components/about-page";
import { AboutResumeTerminal } from "../src/components/about-resume-terminal";
import { portfolioBacktestInitialRange } from "../src/components/portfolio-backtest-page";
import PhotographyPage from "../src/components/photography-page";

test("portfolio defaults follow the New York market date instead of UTC", () => {
  assert.deepEqual(
    portfolioBacktestInitialRange(new Date("2026-09-26T00:30:00.000Z")),
    { start: "2021-09-25", end: "2026-09-25" },
  );
});

test("homepage retains an image and all three destinations before browser effects run", () => {
  const html = renderToStaticMarkup(createElement(HomeLandingPage));
  assert.match(html, /<img[^>]+src="\/image\/siu-hero.webp"[^>]+alt="Siu/);
  for (const destination of ["#/market-lab", "#/photography", "#/about"]) {
    assert.ok(html.includes(`href="${destination}"`));
  }
  assert.match(html, /data analyst/i);
});

test("professional information and the unchanged PDF are available without terminal animation", () => {
  const html = renderToStaticMarkup(createElement(AboutPage));
  for (const company of [
    "Canvas Worldwide",
    "Pensa Systems",
    "The Tactician",
    "COOP",
  ]) {
    assert.ok(html.includes(company));
  }
  for (const project of [
    "Stocks Intelligence Watcher",
    "S&amp;P 500 Market Breadth",
    "Portfolio vs SPY",
  ]) {
    assert.ok(html.includes(project));
  }
  assert.match(html, /Jan 2022 — Present/);
  assert.match(html, /Software Development Lifecycle/);
  assert.match(html, /href="\/docs\/SiuChunKung_Resume.pdf"/);
  assert.deepEqual(
    readFileSync("public/docs/SiuChunKung_Resume.pdf"),
    readFileSync("docs/SiuChunKung_Resume.pdf"),
  );
});

test("reduced-motion visitors receive the complete terminal immediately with no replay control", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: true }) },
  });
  try {
    const html = renderToStaticMarkup(createElement(AboutResumeTerminal));
    assert.match(html, /PROFILE READY \/ 100%/);
    assert.match(html, /Ready. Explore the full résumé below./);
    assert.doesNotMatch(html, /<button/);
    const home = renderToStaticMarkup(createElement(HomeLandingPage));
    assert.doesNotMatch(home, /Pause portrait animation/);
    assert.match(home, /<img[^>]+alt="Siu/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("personal photography uses local assets and keyboard reachable viewer triggers", () => {
  const html = renderToStaticMarkup(createElement(PhotographyPage));
  assert.doesNotMatch(html, /unsplash/);
  assert.equal((html.match(/aria-label="View photograph:/g) || []).length, 22);
  assert.match(html, /<dialog[^>]+aria-label="Photograph viewer"/);
});
