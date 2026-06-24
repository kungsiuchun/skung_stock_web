// scripts/gex-calculator.ts
/**
 * SPX Gamma Exposure (GEX) Calculator
 * Fetches CBOE delayed options chain for SPX and calculates:
 * - Gamma Flip Level (Zero Gamma)
 * - Most LONG/SHORT strike walls
 * - Net GEX
 * 
 * Data source: CBOE Delayed Quotes (free, no auth required)
 * Previously used Yahoo Finance which now blocks cookie/crumb auth.
 */

const CBOE_SPX_OPTIONS_URL = 'https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json';
const CBOE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Math utilities for Black-Scholes
function stdNormalPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function calculateGamma(S: number, K: number, T: number, r: number, sigma: number): number {
    if (T <= 0 || sigma <= 0) return 0;
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    return stdNormalPDF(d1) / (S * sigma * Math.sqrt(T));
}

interface CboeOption {
    option: string;
    open_interest: number;
    volume: number;
    iv: number;
    gamma: number;
    delta: number;
    last_trade_price: number;
    bid: number;
    ask: number;
}

function parseCboeSymbol(symbol: string): { expiry: string; side: 'C' | 'P'; strike: number } | null {
    const match = symbol.match(/^(?:SPX|SPXW)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
    if (!match) return null;
    const [, yy, mm, dd, side, strikeRaw] = match;
    const strike = Number(strikeRaw) / 1000;
    if (!Number.isFinite(strike)) return null;
    const expiry = `20${yy}-${mm}-${dd}`;
    return { expiry, side: side as 'C' | 'P', strike };
}

export async function fetchAndCalculateGEX() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(CBOE_SPX_OPTIONS_URL, {
            headers: { 'User-Agent': CBOE_USER_AGENT, 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`CBOE API error: ${res.status}`);

        const payload = await res.json() as any;
        const spot = payload.data?.current_price;
        if (!spot || !Number.isFinite(spot)) throw new Error("No spot price from CBOE");

        const rawOptions: CboeOption[] = payload.data?.options || [];
        if (rawOptions.length === 0) throw new Error("No options data from CBOE");

        const r = 0.05;
        const minStrike = spot * 0.80;
        const maxStrike = spot * 1.20;
        const now = Date.now();

        // Parse and group options by expiry
        const optionsByExpiry = new Map<string, { calls: any[]; puts: any[]; expiryMs: number }>();

        for (const opt of rawOptions) {
            const parsed = parseCboeSymbol(opt.option);
            if (!parsed) continue;
            if (parsed.strike < minStrike || parsed.strike > maxStrike) continue;

            const oi = opt.open_interest || 0;
            if (!oi) continue;

            // Normalize IV: CBOE returns IV as decimal (e.g., 0.25 = 25%) or sometimes >1
            let iv = opt.iv;
            if (iv > 3) iv = iv / 100; // e.g., 5.15 → 0.0515 (deep ITM, fine)
            if (!iv || iv <= 0) continue;

            if (!optionsByExpiry.has(parsed.expiry)) {
                const expiryDate = new Date(parsed.expiry + 'T16:00:00-04:00');
                optionsByExpiry.set(parsed.expiry, { calls: [], puts: [], expiryMs: expiryDate.getTime() });
            }

            const group = optionsByExpiry.get(parsed.expiry)!;
            const legData = { strike: parsed.strike, oi, iv };
            if (parsed.side === 'C') {
                group.calls.push(legData);
            } else {
                group.puts.push(legData);
            }
        }

        // Sort expiries and take nearest 5
        const sortedExpiries = Array.from(optionsByExpiry.entries())
            .sort((a, b) => a[1].expiryMs - b[1].expiryMs)
            .filter(([, v]) => v.expiryMs > now)
            .slice(0, 5);

        const gexByStrike = new Map<number, { callGEX: number; putGEX: number; netGEX: number }>();
        let totalCallGex = 0;
        let totalPutGex = 0;
        let zeroDteCallGex = 0;
        let zeroDtePutGex = 0;

        for (let idx = 0; idx < sortedExpiries.length; idx++) {
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
            strike, ...data
        })).sort((a, b) => a.strike - b.strike);

        // Find Zero Gamma (Flip Level) by simulating spot prices
        let flipLevel = spot;
        const levels = [];
        for (let S_sim = spot * 0.90; S_sim <= spot * 1.10; S_sim += spot * 0.001) {
            levels.push(S_sim);
        }

        let prevTotalGEX: number | null = null;
        let prevLevel: number | null = null;

        for (const S_sim of levels) {
            let simTotalGEX = 0;
            const multiplier = 100 * S_sim * S_sim * 0.01 / 1e9;

            for (const [, group] of sortedExpiries) {
                let T = (group.expiryMs - now) / (365 * 24 * 3600 * 1000);
                if (T <= 0.001) T = 0.001;

                for (const call of group.calls) {
                    const gamma = calculateGamma(S_sim, call.strike, T, r, call.iv);
                    simTotalGEX += call.oi * gamma * multiplier;
                }
                for (const put of group.puts) {
                    const gamma = calculateGamma(S_sim, put.strike, T, r, put.iv);
                    simTotalGEX -= put.oi * gamma * multiplier;
                }
            }

            if (prevTotalGEX !== null && prevLevel !== null) {
                if ((prevTotalGEX > 0 && simTotalGEX < 0) || (prevTotalGEX < 0 && simTotalGEX > 0)) {
                    const ratio = Math.abs(prevTotalGEX) / (Math.abs(prevTotalGEX) + Math.abs(simTotalGEX));
                    flipLevel = prevLevel + ratio * (S_sim - prevLevel);
                    break;
                }
            }
            prevTotalGEX = simTotalGEX;
            prevLevel = S_sim;
        }

        const sortedLong = [...gexProfile].sort((a, b) => b.netGEX - a.netGEX);
        const sortedShort = [...gexProfile].sort((a, b) => a.netGEX - b.netGEX);

        const mostLongStrike = sortedLong[0]?.strike || 0;
        const mostLongGex = sortedLong[0]?.netGEX.toFixed(2) + 'B';
        const mostShortStrike = sortedShort[0]?.strike || 0;
        const mostShortGex = sortedShort[0]?.netGEX.toFixed(2) + 'B';

        const totalNetGEX = totalCallGex + totalPutGex;
        const gammaStatus = totalNetGEX > 0 ? 'positive_gamma' : 'negative_gamma';
        const zeroDteNetGEX = zeroDteCallGex + zeroDtePutGex;
        const zeroDteGammaStatus = zeroDteNetGEX > 0 ? 'positive_gamma' : 'negative_gamma';

        return {
            spot,
            gammaFlipLevel: Math.round(flipLevel),
            gammaStatus,
            broadGammaStatus: gammaStatus,
            zeroDteGammaStatus,
            totalNetGex: Number(totalNetGEX.toFixed(4)),
            zeroDteNetGex: Number(zeroDteNetGEX.toFixed(4)),
            mostLongStrike,
            mostLongGex: '+' + mostLongGex,
            mostShortStrike,
            mostShortGex: mostShortGex,
            longWalls: sortedLong.slice(0, 3).map(w => ({ strike: w.strike, gex: '+' + w.netGEX.toFixed(2) + 'B' })),
            shortPockets: sortedShort.slice(0, 3).map(w => ({ strike: w.strike, gex: w.netGEX.toFixed(2) + 'B' })),
            generatedAt: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }) + ' ET (CBOE Delayed)',
            parsedAt: new Date().toISOString(),
        };

    } catch (err) {
        console.error("GEX Calculation Error:", err);
        return null;
    }
}

