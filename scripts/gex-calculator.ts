import { RSI } from 'technicalindicators';

// scripts/gex-calculator.ts
/**
 * SPX Gamma Exposure (GEX) Calculator
 * Fetches Yahoo Finance delayed options chain for SPX and calculates:
 * - Gamma Flip Level (Zero Gamma)
 * - Most LONG/SHORT strike walls
 * - Net GEX
 */

// Math utilities for Black-Scholes
function stdNormalPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function calculateGamma(S: number, K: number, T: number, r: number, sigma: number): number {
    if (T <= 0 || sigma <= 0) return 0;
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    return stdNormalPDF(d1) / (S * sigma * Math.sqrt(T));
}

export async function fetchAndCalculateGEX() {
    try {
        // Step 1: Fetch Crumb & Cookie from Yahoo
        const cookieRes = await fetch('https://fc.yahoo.com', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            redirect: 'manual' 
        });
        const cookies = cookieRes.headers.get('set-cookie') || '';
        const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookies }
        });
        const crumb = await crumbRes.text();
        if (!crumb) throw new Error("Failed to get crumb");

        // Step 2: Fetch Options Chain (nearest expiration)
        const symbol = '%5ESPX';
        const url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}?crumb=${crumb}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookies }
        });
        if (!res.ok) throw new Error("Failed to fetch options chain");

        const data = await res.json() as any;
        const result = data.optionChain.result[0];
        const spot = result.quote.regularMarketPrice;
        const expirationDates = result.expirationDates || [];

        // Fetch up to 5 nearest expirations for a better Gamma profile
        const datesToFetch = expirationDates.slice(0, 5);
        const allOptions: any[] = [];
        allOptions.push(result.options[0]); // First one is already included in the base response

        for (let i = 1; i < datesToFetch.length; i++) {
            const dateUrl = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}?crumb=${crumb}&date=${datesToFetch[i]}`;
            const dateRes = await fetch(dateUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookies } });
            if (dateRes.ok) {
                const dateData = await dateRes.json() as any;
                if (dateData.optionChain.result[0]?.options?.[0]) {
                    allOptions.push(dateData.optionChain.result[0].options[0]);
                }
            }
        }

        const r = 0.05; // Assumed 5% risk-free rate
        const minStrike = spot * 0.80;
        const maxStrike = spot * 1.20;

        const gexByStrike = new Map<number, { callGEX: number, putGEX: number, netGEX: number }>();
        let totalCallGex = 0;
        let totalPutGex = 0;

        const now = Date.now() / 1000;

        // Process all options across all fetched expirations for Spot GEX
        for (const opt of allOptions) {
            let T = (opt.expirationDate - now) / (365 * 24 * 3600);
            if (T <= 0.001) T = 0.001;
            
            const multiplier = 100 * spot * spot * 0.01 / 1e9;

            for (const call of opt.calls || []) {
                if (call.strike < minStrike || call.strike > maxStrike) continue;
                const callOI = call.openInterest || call.volume || 0;
                if (!callOI || !call.impliedVolatility) continue;

                const gamma = calculateGamma(spot, call.strike, T, r, call.impliedVolatility);
                const gex = callOI * gamma * multiplier;
                
                const entry = gexByStrike.get(call.strike) || { callGEX: 0, putGEX: 0, netGEX: 0 };
                entry.callGEX += gex;
                entry.netGEX += gex;
                gexByStrike.set(call.strike, entry);
                totalCallGex += gex;
            }

            for (const put of opt.puts || []) {
                if (put.strike < minStrike || put.strike > maxStrike) continue;
                const putOI = put.openInterest || put.volume || 0;
                if (!putOI || !put.impliedVolatility) continue;

                const gamma = calculateGamma(spot, put.strike, T, r, put.impliedVolatility);
                const gex = -(putOI * gamma * multiplier);
                
                const entry = gexByStrike.get(put.strike) || { callGEX: 0, putGEX: 0, netGEX: 0 };
                entry.putGEX += gex;
                entry.netGEX += gex;
                gexByStrike.set(put.strike, entry);
                totalPutGex += gex;
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

        let prevTotalGEX = null;
        let prevLevel = null;

        for (const S_sim of levels) {
            let simTotalGEX = 0;
            const multiplier = 100 * S_sim * S_sim * 0.01 / 1e9;

            for (const opt of allOptions) {
                let T = (opt.expirationDate - now) / (365 * 24 * 3600);
                if (T <= 0.001) T = 0.001;

                for (const call of opt.calls || []) {
                    if (call.strike < spot * 0.8 || call.strike > spot * 1.2) continue;
                    const callOI = call.openInterest || call.volume || 0;
                    if (!callOI || !call.impliedVolatility) continue;
                    const gamma = calculateGamma(S_sim, call.strike, T, r, call.impliedVolatility);
                    simTotalGEX += callOI * gamma * multiplier;
                }
                for (const put of opt.puts || []) {
                    if (put.strike < spot * 0.8 || put.strike > spot * 1.2) continue;
                    const putOI = put.openInterest || put.volume || 0;
                    if (!putOI || !put.impliedVolatility) continue;
                    const gamma = calculateGamma(S_sim, put.strike, T, r, put.impliedVolatility);
                    simTotalGEX -= putOI * gamma * multiplier;
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

        return {
            spot,
            gammaFlipLevel: Math.round(flipLevel),
            gammaStatus,
            mostLongStrike,
            mostLongGex: '+' + mostLongGex,
            mostShortStrike,
            mostShortGex: mostShortGex,
            longWalls: sortedLong.slice(0, 3).map(w => ({ strike: w.strike, gex: '+' + w.netGEX.toFixed(2) + 'B' })),
            shortPockets: sortedShort.slice(0, 3).map(w => ({ strike: w.strike, gex: w.netGEX.toFixed(2) + 'B' })),
            generatedAt: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }) + ' ET (Delayed)',
            parsedAt: new Date().toISOString(),
        };

    } catch (err) {
        console.error("GEX Calculation Error:", err);
        return null;
    }
}
