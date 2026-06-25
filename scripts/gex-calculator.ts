// scripts/gex-calculator.ts
/**
 * SPX Gamma Exposure (GEX) Calculator
 * Calculates:
 * - Gamma Flip Level (Zero Gamma)
 * - Most LONG/SHORT strike walls
 * - Net GEX
 *
 * Data source: normalized SPX option chains, normally from CBOE delayed data.
 */

import { parseCboeSpxOptionsPayload } from "../src/lib/spx-gex-cboe";
import type { SpxGexOptionChain, SpxGexOptionLeg } from "../src/lib/spx-gex-heatmap";

const CBOE_SPX_OPTIONS_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json";
const CBOE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function stdNormalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function calculateGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  return stdNormalPDF(d1) / (S * sigma * Math.sqrt(T));
}

const ivToDecimal = (leg: SpxGexOptionLeg) => {
  const iv = Number(leg.impliedVolatility || 0);
  if (!iv || iv <= 0) return null;
  return iv > 3 ? iv / 100 : iv;
};

export function calculateGexFromOptionChains(chains: SpxGexOptionChain[], calculationNow: Date = new Date()) {
  try {
    const spot = chains[0]?.spot;
    if (!spot || !Number.isFinite(spot)) throw new Error("No spot price from CBOE");
    if (chains.length === 0) throw new Error("No options data from CBOE");

    const r = 0.05;
    const now = calculationNow.getTime();
    const optionsByExpiry = new Map<string, { calls: any[]; puts: any[]; expiryMs: number }>();

    for (const chain of chains) {
      if (!chain.selectedExpiry) continue;
      if (!optionsByExpiry.has(chain.selectedExpiry)) {
        const expiryDate = new Date(chain.selectedExpiry + "T16:00:00-04:00");
        optionsByExpiry.set(chain.selectedExpiry, { calls: [], puts: [], expiryMs: expiryDate.getTime() });
      }

      const group = optionsByExpiry.get(chain.selectedExpiry)!;
      for (const call of chain.calls) {
        const oi = Number(call.openInterest || 0);
        const iv = ivToDecimal(call);
        if (!oi || !iv) continue;
        group.calls.push({ strike: call.strike, oi, iv });
      }
      for (const put of chain.puts) {
        const oi = Number(put.openInterest || 0);
        const iv = ivToDecimal(put);
        if (!oi || !iv) continue;
        group.puts.push({ strike: put.strike, oi, iv });
      }
    }

    const sortedExpiries = Array.from(optionsByExpiry.entries())
      .sort((a, b) => a[1].expiryMs - b[1].expiryMs)
      .filter(([, value]) => value.expiryMs > now)
      .slice(0, 5);

    const gexByStrike = new Map<number, { callGEX: number; putGEX: number; netGEX: number }>();
    let totalCallGex = 0;
    let totalPutGex = 0;
    let zeroDteCallGex = 0;
    let zeroDtePutGex = 0;

    for (let idx = 0; idx < sortedExpiries.length; idx += 1) {
      const [, group] = sortedExpiries[idx];
      const isNearestExpiry = idx === 0;
      let T = (group.expiryMs - now) / (365 * 24 * 3600 * 1000);
      if (T <= 0.001) T = 0.001;

      const multiplier = 100 * spot * spot * 0.01 / 1e9;

      for (const call of group.calls) {
        const gamma = calculateGamma(spot, call.strike, T, r, call.iv);
        const gex = call.oi * gamma * multiplier;

        const entry = gexByStrike.get(call.strike) || { callGEX: 0, putGEX: 0, netGEX: 0 };
        entry.callGEX += gex;
        entry.netGEX += gex;
        gexByStrike.set(call.strike, entry);
        totalCallGex += gex;
        if (isNearestExpiry) zeroDteCallGex += gex;
      }

      for (const put of group.puts) {
        const gamma = calculateGamma(spot, put.strike, T, r, put.iv);
        const gex = -(put.oi * gamma * multiplier);

        const entry = gexByStrike.get(put.strike) || { callGEX: 0, putGEX: 0, netGEX: 0 };
        entry.putGEX += gex;
        entry.netGEX += gex;
        gexByStrike.set(put.strike, entry);
        totalPutGex += gex;
        if (isNearestExpiry) zeroDtePutGex += gex;
      }
    }

    const gexProfile = Array.from(gexByStrike.entries()).map(([strike, data]) => ({
      strike,
      ...data,
    })).sort((a, b) => a.strike - b.strike);

    let flipLevel = spot;
    const levels = [];
    for (let simulatedSpot = spot * 0.90; simulatedSpot <= spot * 1.10; simulatedSpot += spot * 0.001) {
      levels.push(simulatedSpot);
    }

    let prevTotalGEX: number | null = null;
    let prevLevel: number | null = null;

    for (const simulatedSpot of levels) {
      let simTotalGEX = 0;
      const multiplier = 100 * simulatedSpot * simulatedSpot * 0.01 / 1e9;

      for (const [, group] of sortedExpiries) {
        let T = (group.expiryMs - now) / (365 * 24 * 3600 * 1000);
        if (T <= 0.001) T = 0.001;

        for (const call of group.calls) {
          const gamma = calculateGamma(simulatedSpot, call.strike, T, r, call.iv);
          simTotalGEX += call.oi * gamma * multiplier;
        }
        for (const put of group.puts) {
          const gamma = calculateGamma(simulatedSpot, put.strike, T, r, put.iv);
          simTotalGEX -= put.oi * gamma * multiplier;
        }
      }

      if (prevTotalGEX !== null && prevLevel !== null) {
        if ((prevTotalGEX > 0 && simTotalGEX < 0) || (prevTotalGEX < 0 && simTotalGEX > 0)) {
          const ratio = Math.abs(prevTotalGEX) / (Math.abs(prevTotalGEX) + Math.abs(simTotalGEX));
          flipLevel = prevLevel + ratio * (simulatedSpot - prevLevel);
          break;
        }
      }
      prevTotalGEX = simTotalGEX;
      prevLevel = simulatedSpot;
    }

    const sortedLong = [...gexProfile].sort((a, b) => b.netGEX - a.netGEX);
    const sortedShort = [...gexProfile].sort((a, b) => a.netGEX - b.netGEX);

    const mostLongStrike = sortedLong[0]?.strike || 0;
    const mostLongGex = sortedLong[0]?.netGEX.toFixed(2) + "B";
    const mostShortStrike = sortedShort[0]?.strike || 0;
    const mostShortGex = sortedShort[0]?.netGEX.toFixed(2) + "B";

    const totalNetGEX = totalCallGex + totalPutGex;
    const gammaStatus = totalNetGEX > 0 ? "positive_gamma" : "negative_gamma";
    const zeroDteNetGEX = zeroDteCallGex + zeroDtePutGex;
    const zeroDteGammaStatus = zeroDteNetGEX > 0 ? "positive_gamma" : "negative_gamma";

    return {
      spot,
      gammaFlipLevel: Math.round(flipLevel),
      gammaStatus,
      broadGammaStatus: gammaStatus,
      zeroDteGammaStatus,
      totalNetGex: Number(totalNetGEX.toFixed(4)),
      zeroDteNetGex: Number(zeroDteNetGEX.toFixed(4)),
      mostLongStrike,
      mostLongGex: "+" + mostLongGex,
      mostShortStrike,
      mostShortGex,
      longWalls: sortedLong.slice(0, 3).map((wall) => ({ strike: wall.strike, gex: "+" + wall.netGEX.toFixed(2) + "B" })),
      shortPockets: sortedShort.slice(0, 3).map((wall) => ({ strike: wall.strike, gex: wall.netGEX.toFixed(2) + "B" })),
      generatedAt: calculationNow.toLocaleTimeString("en-US", { timeZone: "America/New_York" }) + " ET (CBOE Delayed)",
      parsedAt: calculationNow.toISOString(),
    };
  } catch (err) {
    console.error("GEX Calculation Error:", err);
    return null;
  }
}

export async function fetchAndCalculateGEX() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(CBOE_SPX_OPTIONS_URL, {
      headers: { "User-Agent": CBOE_USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`CBOE API error: ${res.status}`);

    const payload = await res.json() as unknown;
    return calculateGexFromOptionChains(parseCboeSpxOptionsPayload(payload));
  } catch (err) {
    console.error("GEX Calculation Error:", err);
    return null;
  }
}
