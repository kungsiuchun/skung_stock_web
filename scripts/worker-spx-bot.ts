import { RSI, BollingerBands, SMA, MACD, EMA } from 'technicalindicators';
import { PERSONAS, ORCHESTRATOR_PROMPT, SYSTEM_PROMPT_PREFIX, SYSTEM_PROMPT_IC, AUDIT_AGENT_PROMPT, ALPHA_EAR_SENTIMENT_PROMPT } from './prompts';
import { fetchAndCalculateGEX } from './gex-calculator';
import { upsertRecapDay, type D1DatabaseLike } from '../src/lib/spx-recap-d1';
import { generateAndStoreSpxGexHeatmap } from '../src/lib/spx-gex-heatmap';
import { NativeSpxGexYahooClient } from '../src/lib/stocks-native-yahoo';

// Cloudflare Worker Environment Types
interface Env {
  TELEGRAM_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  WEBHOOK_SECRET?: string; // 🔒 防護互聯網隨機觸發的安全金鑰
  SPX_MEMORY: any;
  SPX_RECAP_DB?: D1DatabaseLike;
}

interface ActionLogItem {
  time: string;
  price: number;
  action: string;
  reasoning: string;
  pnl?: number;
  buyZone?: string;
  stopLoss?: string;
  takeProfit?: string;
  riskWarning?: string;
  ruleEngineVerdict?: string;
  signalScore?: number;
}
interface DailyMemory {
  currentPosition: "NONE" | "CALL" | "PUT";
  entryPrice: number | null;
  entryTime: string | null;
  actionLog: ActionLogItem[];
  // Iron Condor tracking
  icPosition: "NONE" | "DEPLOYED" | "PARTIAL" | "ROLLING";
  icDeployTime: string | null;
  icAction: string | null;
}
interface TrendDayContext {
  regime: "BULL_TREND_DAY" | "BEAR_TREND_DAY" | "RANGE_OR_MIXED";
  directionalBias: "CALL" | "PUT" | "NONE";
  confidence: number;
  recommendedAction: "OPEN_CALL" | "OPEN_PUT" | "HOLD";
  icAllowed: boolean;
  icBlockReason: string | null;
  previousClose: number | null;
  dayOpen: number | null;
  dayChangePct: number | null;
  fromOpenPct: number | null;
  rangePositionPct: number | null;
  priorBoxHigh: number | null;
  priorBoxLow: number | null;
  aboveVWAP: boolean;
  aboveEMA9: boolean;
  aboveGammaFlip: boolean | null;
  nearestExpiryGammaStatus: string | null;
  rationale: string;
}
interface GexData {
  spot?: number;
  gammaFlipLevel?: number;
  gammaStatus?: string;
  broadGammaStatus?: string;
  zeroDteGammaStatus?: string;
  totalNetGex?: number;
  zeroDteNetGex?: number;
  mostLongStrike?: number;
  mostLongGex?: string;
  mostShortStrike?: number;
  mostShortGex?: string;
  longWalls?: { strike: number; gex: string }[];
  shortPockets?: { strike: number; gex: string }[];
  netFlowUpper?: { strike: number; gex: string };
  netFlowLower?: { strike: number; gex: string };
  putCallIvSkew?: number;
  generatedAt?: string;
  parsedAt?: string;
}

interface IntradayKeyLevel {
  level: number;
  touches: number;
  kind: "support" | "resistance";
  distance: number;
}

interface IntradayStructureContext {
  nearestSupport: IntradayKeyLevel | null;
  nearestResistance: IntradayKeyLevel | null;
  repeatedSupport: IntradayKeyLevel | null;
  repeatedResistance: IntradayKeyLevel | null;
  targetDisciplineNote: string;
}

type ZeroDteAdvisoryVerdict =
  | "TRADE_ALLOWED"
  | "WAIT_AND_OBSERVE"
  | "NO_TRADE"
  | "CLOSE_OR_REDUCE_SUGGESTED"
  | "FREEZE_NEW_SIGNALS";

interface ZeroDteRuleEngineResult {
  verdict: ZeroDteAdvisoryVerdict;
  directionalBias: "CALL" | "PUT" | "NONE";
  marketRegime: "TREND" | "CHOP" | "GAMMA_PIN" | "UNKNOWN";
  signalScore: number;
  hardBlocks: string[];
  activeRisks: string[];
  allowNewSignal: boolean;
  hardRuleTriggered: boolean;
  thetaDecayRiskHigh: boolean;
  gammaPinningDetected: boolean;
  liquidityRisk: "UNKNOWN";
}

// --- Helper: Fetch with Timeout ---
async function fetchWithTimeout(url: string, options: any, timeoutMs: number = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// --- 輕量級 Yahoo Finance API 調用 ---

async function fetchYahooChart(symbol: string, interval: string, range: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }, 10000); // 10s timeout for Yahoo

  if (!response.ok) throw new Error(`Yahoo API error: ${response.statusText}`);

  const data = await response.json() as any;
  const result = data.chart.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp || [];
  const quotes = result.indicators.quote[0];

  // 轉換為分析函數期望的格式
  return timestamps.map((t: number, i: number) => ({
    date: new Date(t * 1000),
    open: quotes.open[i],
    high: quotes.high[i],
    low: quotes.low[i],
    close: quotes.close[i],
    volume: quotes.volume[i]
  })).filter((q: any) => q.close !== null);
}

// --- 輕量級 Yahoo Finance 期權 PCR 調用 ---
async function fetchYahooOptionsPCR(symbol: string = '^SPX') {
  try {
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'manual'
    });
    const cookies = cookieRes.headers.get('set-cookie') || '';

    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookies }
    });
    const crumb = await crumbRes.text();
    if (!crumb) return null;

    const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${crumb}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookies }
    });
    if (!res.ok) return null;

    const data = await res.json() as any;
    const options = data.optionChain.result[0].options[0];
    if (!options) return null;

    const calls = options.calls || [];
    const puts = options.puts || [];
    const totalCallVolume = calls.reduce((acc: number, curr: any) => acc + (curr.volume || 0), 0);
    const totalPutVolume = puts.reduce((acc: number, curr: any) => acc + (curr.volume || 0), 0);
    if (totalCallVolume === 0) return null;

    return totalPutVolume / totalCallVolume;
  } catch (e) {
    console.error('Fetch PCR Error:', e);
    return null;
  }
}

// --- 分析與邏輯函數 ---

async function fetchNewsAndSentiment(env: Env) {
  try {
    const res = await fetchWithTimeout('https://query2.finance.yahoo.com/v1/finance/search?q=SPY&newsCount=10', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }, 10000);
    if (!res.ok) return { score: 0, label: 'neutral', reason: `News API error: ${res.status}` };
    const data = await res.json() as any;
    const items = data.news?.slice(0, 10).map((i: any) => i.title).join('\n') || '';

    if (!items) return { score: 0, label: 'neutral', reason: 'No news found' };

    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://spx-trading-pua.kungsiuchun0.workers.dev',
        'X-OpenRouter-Title': 'SPX PUA Agent'
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
        messages: [
          { role: 'system', content: ALPHA_EAR_SENTIMENT_PROMPT },
          { role: 'user', content: `News Headlines:\n${items}` }
        ]
      })
    }, 15000);

    if (response.ok) {
      const gData = await response.json() as any;
      let content = gData.choices[0].message.content;
      content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
      return JSON.parse(content);
    }
  } catch (e) {
    console.error('Sentiment Error:', e);
  }
  return { score: 0, label: 'neutral', reason: 'Sentiment calculation failed' };
}

async function calculateIndicators(quotes: any[]) {
  const closes = quotes.map(q => q.close).filter(c => c !== null) as number[];
  if (closes.length < 20) return null;

  const rsi = RSI.calculate({ values: closes, period: 14 });
  const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const currentRSI = rsi[rsi.length - 1];
  const currentBB = bb[bb.length - 1];
  const currentClose = closes[closes.length - 1];
  const bandwidth = ((currentBB.upper - currentBB.lower) / currentBB.middle) * 100;

  const macd = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  const currentMACD = macd.length > 0 ? macd[macd.length - 1] : null;

  const sma20 = SMA.calculate({ values: closes, period: 20 });
  const sma50 = SMA.calculate({ values: closes, period: 50 });
  const ema9 = EMA.calculate({ values: closes, period: 9 });
  const ema20 = EMA.calculate({ values: closes, period: 20 });

  // Calculate Intraday VWAP (using quotes from the latest trading day)
  const latestDateStr = quotes[quotes.length - 1].date.toDateString();
  const todayQuotes = quotes.filter(q => q.date.toDateString() === latestDateStr);
  let cumulativeTypicalVol = 0;
  let cumulativeVol = 0;
  for (const q of todayQuotes) {
    const typicalPrice = (q.high + q.low + q.close) / 3;
    const vol = q.volume || 0;
    cumulativeTypicalVol += typicalPrice * vol;
    cumulativeVol += vol;
  }
  const currentVWAP = cumulativeVol > 0 ? cumulativeTypicalVol / cumulativeVol : currentClose;
  const vwapDeviation = ((currentClose - currentVWAP) / currentVWAP) * 100;

  return {
    currentClose,
    currentRSI,
    currentBB,
    bandwidth,
    isSqueeze: bandwidth < 1.5,
    recentHigh: quotes[quotes.length - 1].high,
    recentLow: quotes[quotes.length - 1].low,
    volume: quotes[quotes.length - 1].volume || 0,
    sma20: sma20.length > 0 ? sma20[sma20.length - 1] : null,
    sma50: sma50.length > 0 ? sma50[sma50.length - 1] : null,
    macd: currentMACD,
    ema9: ema9.length > 0 ? ema9[ema9.length - 1] : null,
    ema20: ema20.length > 0 ? ema20[ema20.length - 1] : null,
    currentVWAP,
    vwapDeviation
  };
}

function computeTrendDayContext(m5Quotes: any[], indicators: any, gexData: GexData | null): TrendDayContext {
  const fallback: TrendDayContext = {
    regime: "RANGE_OR_MIXED",
    directionalBias: "NONE",
    confidence: 0,
    recommendedAction: "HOLD",
    icAllowed: true,
    icBlockReason: null,
    previousClose: null,
    dayOpen: null,
    dayChangePct: null,
    fromOpenPct: null,
    rangePositionPct: null,
    priorBoxHigh: null,
    priorBoxLow: null,
    aboveVWAP: false,
    aboveEMA9: false,
    aboveGammaFlip: null,
    nearestExpiryGammaStatus: gexData?.zeroDteGammaStatus || gexData?.gammaStatus || null,
    rationale: "5分鐘資料不足，暫時當震盪市處理，唔好硬追方向。"
  };

  const validQuotes = m5Quotes.filter((q: any) => q?.close != null && q?.date instanceof Date);
  if (validQuotes.length < 12) return fallback;

  const latest = validQuotes[validQuotes.length - 1];
  const latestDate = latest.date.toDateString();
  const todayQuotes = validQuotes.filter((q: any) => q.date.toDateString() === latestDate);
  const priorQuotes = validQuotes.filter((q: any) => q.date.toDateString() !== latestDate);
  if (todayQuotes.length < 6) return fallback;

  const currentClose = Number(indicators.currentClose ?? latest.close);
  const previousClose = priorQuotes.length > 0 ? Number(priorQuotes[priorQuotes.length - 1].close) : null;
  const dayOpen = Number(todayQuotes[0].open ?? todayQuotes[0].close);
  const dayHigh = Math.max(...todayQuotes.map((q: any) => Number(q.high ?? q.close)));
  const dayLow = Math.min(...todayQuotes.map((q: any) => Number(q.low ?? q.close)));
  const dayRange = dayHigh - dayLow;
  const dayChangePct = previousClose ? ((currentClose - previousClose) / previousClose) * 100 : null;
  const fromOpenPct = dayOpen ? ((currentClose - dayOpen) / dayOpen) * 100 : null;
  const rangePositionPct = dayRange > 0 ? ((currentClose - dayLow) / dayRange) * 100 : 50;
  const priorWindow = todayQuotes.slice(Math.max(0, todayQuotes.length - 25), Math.max(0, todayQuotes.length - 1));
  const priorBoxHigh = priorWindow.length > 0 ? Math.max(...priorWindow.map((q: any) => Number(q.high ?? q.close))) : null;
  const priorBoxLow = priorWindow.length > 0 ? Math.min(...priorWindow.map((q: any) => Number(q.low ?? q.close))) : null;
  const aboveVWAP = currentClose > Number(indicators.currentVWAP ?? currentClose);
  const ema9 = indicators.ema9 != null ? Number(indicators.ema9) : null;
  const aboveEMA9 = ema9 != null ? currentClose > ema9 : false;
  const aboveGammaFlip = gexData?.gammaFlipLevel ? currentClose > gexData.gammaFlipLevel : null;
  const nearestExpiryGammaStatus = gexData?.zeroDteGammaStatus || gexData?.gammaStatus || null;

  let bullScore = 0;
  if ((dayChangePct ?? 0) >= 0.45) bullScore++;
  if ((fromOpenPct ?? 0) >= 0.25) bullScore++;
  if (aboveVWAP) bullScore++;
  if (aboveEMA9) bullScore++;
  if ((rangePositionPct ?? 50) >= 70) bullScore++;
  if (priorBoxHigh != null && currentClose >= priorBoxHigh - 1) bullScore++;
  if (aboveGammaFlip !== false) bullScore++;

  let bearScore = 0;
  if ((dayChangePct ?? 0) <= -0.45) bearScore++;
  if ((fromOpenPct ?? 0) <= -0.25) bearScore++;
  if (!aboveVWAP) bearScore++;
  if (!aboveEMA9) bearScore++;
  if ((rangePositionPct ?? 50) <= 30) bearScore++;
  if (priorBoxLow != null && currentClose <= priorBoxLow + 1) bearScore++;
  if (aboveGammaFlip !== true) bearScore++;

  const isBullTrend = bullScore >= 5 && aboveVWAP && aboveEMA9 && (((dayChangePct ?? 0) >= 0.45) || ((fromOpenPct ?? 0) >= 0.35));
  const isBearTrend = bearScore >= 5 && !aboveVWAP && !aboveEMA9 && (((dayChangePct ?? 0) <= -0.45) || ((fromOpenPct ?? 0) <= -0.35));
  const confidence = Math.round((Math.max(bullScore, bearScore) / 7) * 100);
  const fmt = (n: number | null) => n == null || !Number.isFinite(n) ? "N/A" : n.toFixed(2);

  if (isBullTrend) {
    const rationale = `單邊上升日：較昨日升 ${fmt(dayChangePct)}%，較開市升 ${fmt(fromOpenPct)}%，價格企在 VWAP/EMA9 之上，位於今日波幅頂部 ${Math.round(rangePositionPct)}%。`;
    return {
      regime: "BULL_TREND_DAY",
      directionalBias: "CALL",
      confidence,
      recommendedAction: "OPEN_CALL",
      icAllowed: false,
      icBlockReason: "單邊上升日唔適合開中性 0DTE 鐵鷹，容易被 CALL 邊打穿。",
      previousClose,
      dayOpen,
      dayChangePct,
      fromOpenPct,
      rangePositionPct,
      priorBoxHigh,
      priorBoxLow,
      aboveVWAP,
      aboveEMA9,
      aboveGammaFlip,
      nearestExpiryGammaStatus,
      rationale
    };
  }

  if (isBearTrend) {
    const rationale = `單邊下跌日：較昨日跌 ${fmt(dayChangePct)}%，較開市跌 ${fmt(fromOpenPct)}%，價格壓在 VWAP/EMA9 之下，位於今日波幅底部 ${Math.round(rangePositionPct)}%。`;
    return {
      regime: "BEAR_TREND_DAY",
      directionalBias: "PUT",
      confidence,
      recommendedAction: "OPEN_PUT",
      icAllowed: false,
      icBlockReason: "單邊下跌日唔適合開中性 0DTE 鐵鷹，容易被 PUT 邊打穿。",
      previousClose,
      dayOpen,
      dayChangePct,
      fromOpenPct,
      rangePositionPct,
      priorBoxHigh,
      priorBoxLow,
      aboveVWAP,
      aboveEMA9,
      aboveGammaFlip,
      nearestExpiryGammaStatus,
      rationale
    };
  }

  return {
    regime: "RANGE_OR_MIXED",
    directionalBias: "NONE",
    confidence,
    recommendedAction: "HOLD",
    icAllowed: true,
    icBlockReason: null,
    previousClose,
    dayOpen,
    dayChangePct,
    fromOpenPct,
    rangePositionPct,
    priorBoxHigh,
    priorBoxLow,
    aboveVWAP,
    aboveEMA9,
    aboveGammaFlip,
    nearestExpiryGammaStatus,
    rationale: `震盪或方向未清：多方分 ${bullScore}/7，空方分 ${bearScore}/7，未夠資格當單邊日。`
  };
}

function isBeforeEtCutoff(etDate: Date, hour: number, minute: number) {
  const minutes = etDate.getHours() * 60 + etDate.getMinutes();
  return minutes < (hour * 60 + minute);
}

function planReason(plan: any) {
  return plan?.logic || plan?.action_reasoning || plan?.buy_zone || plan?.risk_warning || "策略未提供具體理由";
}

async function getFundFlow(quotes: any[], etfQuotes: Record<string, any[]> = {}) {
  const windowSize = 24;
  const recentQuotes = quotes.slice(-windowSize);
  if (recentQuotes.length === 0) return null;

  let totalNet = 0;
  let superLarge = 0;
  let large = 0;
  let medium = 0;
  let small = 0;

  for (const q of recentQuotes) {
    const range = q.high - q.low;
    const buyPower = range > 0 ? (q.close - q.low) / range : 0.5;
    const netRatio = (buyPower - 0.5) * 2;
    const dollarVol = (q.volume || 1000000) * q.close;

    superLarge += dollarVol * 0.3 * netRatio;
    large += dollarVol * 0.25 * netRatio;
    medium += dollarVol * 0.25 * netRatio;
    small += dollarVol * 0.2 * netRatio;
  }

  totalNet = superLarge + large;

  // ETF Flow Analysis
  let etfInterpretation = "";
  if (etfQuotes['SPY'] && etfQuotes['IWM'] && etfQuotes['SPY'].length >= 2 && etfQuotes['IWM'].length >= 2) {
    const spyRet = etfQuotes['SPY'].slice(-1)[0]?.close / etfQuotes['SPY'].slice(-2)[0]?.close - 1;
    const iwmRet = etfQuotes['IWM'].slice(-1)[0]?.close / etfQuotes['IWM'].slice(-2)[0]?.close - 1;
    if (spyRet > 0 && iwmRet > 0) etfInterpretation += "全局 Risk-On (SPY/IWM 雙漲)。";
    else if (spyRet < 0 && iwmRet < 0) etfInterpretation += "全局 Risk-Off (SPY/IWM 雙跌)。";
    else etfInterpretation += "市場分化 (SPY/IWM 背離)。";
  }

  if (etfQuotes['XLK'] && etfQuotes['XLV'] && etfQuotes['XLK'].length >= 2 && etfQuotes['XLV'].length >= 2) {
    const xlkRet = etfQuotes['XLK'].slice(-1)[0]?.close / etfQuotes['XLK'].slice(-2)[0]?.close - 1;
    const xlvRet = etfQuotes['XLV'].slice(-1)[0]?.close / etfQuotes['XLV'].slice(-2)[0]?.close - 1;
    if (xlkRet > xlvRet) etfInterpretation += " 週期強於防禦 (XLK > XLV)，偏好成長。";
    else etfInterpretation += " 防禦強於週期 (XLV > XLK)，資金避險。";
  }

  return {
    mainNetInflow: totalNet,
    superLarge,
    large,
    medium,
    small,
    interpretation: (totalNet > 0 ? "主力資金強勢掃貨，" : "主力資金高位套現，") + etfInterpretation
  };
}

// --- Price Action Context Calculator ---
function calculatePriceActionContext(d1Quotes: any[], h1Quotes: any[]) {
  if (d1Quotes.length < 10 || h1Quotes.length < 10) return null;

  // D1 structure: find recent HH/HL or LH/LL
  const d1Closes = d1Quotes.slice(-20);
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = 2; i < d1Closes.length - 2; i++) {
    const h = d1Closes[i].high;
    const l = d1Closes[i].low;
    if (h > d1Closes[i-1].high && h > d1Closes[i-2].high && h > d1Closes[i+1].high && h > d1Closes[i+2].high) swingHighs.push(h);
    if (l < d1Closes[i-1].low && l < d1Closes[i-2].low && l < d1Closes[i+1].low && l < d1Closes[i+2].low) swingLows.push(l);
  }

  let macroTrend = 'RANGING';
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const hh = swingHighs[swingHighs.length - 1] > swingHighs[swingHighs.length - 2];
    const hl = swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];
    const lh = swingHighs[swingHighs.length - 1] < swingHighs[swingHighs.length - 2];
    const ll = swingLows[swingLows.length - 1] < swingLows[swingLows.length - 2];
    if (hh && hl) macroTrend = 'UPTREND (HH/HL)';
    else if (lh && ll) macroTrend = 'DOWNTREND (LH/LL)';
  }

  // Detect recent BOS/CHoCH from last 5 D1 candles
  const recent5 = d1Closes.slice(-5);
  let recentBOS = false;
  let recentCHoCH = false;
  if (recent5.length >= 3) {
    const prevHigh = Math.max(recent5[0].high, recent5[1].high);
    const prevLow = Math.min(recent5[0].low, recent5[1].low);
    const latestClose = recent5[recent5.length - 1].close;
    if (macroTrend.includes('UPTREND') && latestClose > prevHigh) recentBOS = true;
    if (macroTrend.includes('DOWNTREND') && latestClose < prevLow) recentBOS = true;
    if (macroTrend.includes('UPTREND') && latestClose < prevLow) recentCHoCH = true;
    if (macroTrend.includes('DOWNTREND') && latestClose > prevHigh) recentCHoCH = true;
  }

  // Find nearest Order Block (last opposing candle before impulse) from 1H
  const h1Recent = h1Quotes.slice(-30);
  let nearestOB: { high: number; low: number; type: string } | null = null;
  for (let i = h1Recent.length - 3; i >= 1; i--) {
    const curr = h1Recent[i];
    const next = h1Recent[i + 1];
    const impulseUp = (next.close - next.open) > (curr.high - curr.low) * 1.5 && curr.close < curr.open;
    const impulseDown = (next.open - next.close) > (curr.high - curr.low) * 1.5 && curr.close > curr.open;
    if (impulseUp) { nearestOB = { high: curr.high, low: curr.low, type: '看漲訂單塊 (Bullish OB)' }; break; }
    if (impulseDown) { nearestOB = { high: curr.high, low: curr.low, type: '看跌訂單塊 (Bearish OB)' }; break; }
  }

  // Find nearest FVG from 1H
  let nearestFVG: { high: number; low: number; type: string } | null = null;
  for (let i = h1Recent.length - 1; i >= 2; i--) {
    const c1 = h1Recent[i - 2];
    const c3 = h1Recent[i];
    if (c3.low > c1.high) { nearestFVG = { high: c3.low, low: c1.high, type: '看漲缺口 (Bullish FVG)' }; break; }
    if (c1.low > c3.high) { nearestFVG = { high: c1.low, low: c3.high, type: '看跌缺口 (Bearish FVG)' }; break; }
  }

  // Fibonacci golden pocket from last swing
  const recentHigh = Math.max(...d1Closes.slice(-10).map((q: any) => q.high));
  const recentLow = Math.min(...d1Closes.slice(-10).map((q: any) => q.low));
  const range = recentHigh - recentLow;
  const fibGoldenPocket = macroTrend.includes('UPTREND')
    ? { top: recentHigh - range * 0.618, bottom: recentHigh - range * 0.786 }
    : { top: recentLow + range * 0.786, bottom: recentLow + range * 0.618 };

  return {
    macroTrend,
    recentBOS,
    recentCHoCH,
    swingHighs: swingHighs.slice(-3).map(h => h.toFixed(2)),
    swingLows: swingLows.slice(-3).map(l => l.toFixed(2)),
    nearestOB: nearestOB ? `${nearestOB.type} [${nearestOB.low.toFixed(2)}-${nearestOB.high.toFixed(2)}]` : 'None detected',
    nearestFVG: nearestFVG ? `${nearestFVG.type} [${nearestFVG.low.toFixed(2)}-${nearestFVG.high.toFixed(2)}]` : 'None detected',
    fibGoldenPocket: `${fibGoldenPocket.bottom.toFixed(2)} - ${fibGoldenPocket.top.toFixed(2)}`
  };
}

// --- IV Percentile Calculator (VIX-based for SPX) ---
function calculateIVPercentile(vixQuotes: any[]): number {
  if (vixQuotes.length < 20) return 50;
  const closes = vixQuotes.map((q: any) => q.close).filter((c: number) => c !== null);
  const currentVix = closes[closes.length - 1];
  const belowCount = closes.filter((v: number) => v < currentVix).length;
  return Math.round((belowCount / closes.length) * 100);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getEtMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseEtTimestamp(input: string | null): Date | null {
  if (!input) return null;
  const nums = input.match(/\d+/g)?.map(Number);
  if (!nums || nums.length < 5) return null;
  const [year, month, day, hour, minute, second = 0] = nums;
  return new Date(year, month - 1, day, hour, minute, second);
}

const MARKET_TIME_ZONE = 'America/New_York';
const TRADING_CRON = '*/15 14-20 * * MON-FRI';
const AUDIT_CRON = '15 17-21 * * MON-FRI';
// SPX GEX collection is gated in src/lib/spx-gex-heatmap.ts as a 15-minute delayed feed:
// collect 09:45-16:15 ET, display represented market time 09:30-16:00 ET.
const SPX_GEX_HEATMAP_CRON = '*/15 13-21 * * MON-FRI';

interface ScheduledRunOptions {
  force?: boolean;
}

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function toEasternDate(date: Date) {
  return new Date(date.toLocaleString('en-US', { timeZone: MARKET_TIME_ZONE }));
}

function observedHolidayKey(year: number, monthIndex: number, day: number) {
  const date = new Date(year, monthIndex, day);
  const weekday = date.getDay();
  if (weekday === 6) date.setDate(date.getDate() - 1);
  if (weekday === 0) date.setDate(date.getDate() + 1);
  return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number) {
  const date = new Date(year, monthIndex, 1);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + offset + (nth - 1) * 7);
  return date;
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
  const date = new Date(year, monthIndex + 1, 0);
  const offset = (date.getDay() - weekday + 7) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function getEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function getFullMarketHolidayKeys(year: number) {
  const holidays = new Set<string>();
  const addDate = (date: Date) => holidays.add(toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()));

  holidays.add(observedHolidayKey(year, 0, 1));
  holidays.add(observedHolidayKey(year + 1, 0, 1));
  addDate(nthWeekdayOfMonth(year, 0, 1, 3));
  addDate(nthWeekdayOfMonth(year, 1, 1, 3));

  const goodFriday = getEasterSunday(year);
  goodFriday.setDate(goodFriday.getDate() - 2);
  addDate(goodFriday);

  addDate(lastWeekdayOfMonth(year, 4, 1));

  if (year >= 2022) {
    holidays.add(observedHolidayKey(year, 5, 19));
  }

  holidays.add(observedHolidayKey(year, 6, 4));
  addDate(nthWeekdayOfMonth(year, 8, 1, 1));
  addDate(nthWeekdayOfMonth(year, 10, 4, 4));
  holidays.add(observedHolidayKey(year, 11, 25));

  return holidays;
}

function getEarlyCloseMarketHolidayKeys(year: number, fullHolidayKeys = getFullMarketHolidayKeys(year)) {
  const earlyCloses = new Set<string>();
  const addIfTradingDay = (date: Date) => {
    const key = toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6 && !fullHolidayKeys.has(key)) {
      earlyCloses.add(key);
    }
  };

  const julyThird = new Date(year, 6, 3);
  addIfTradingDay(julyThird);

  const dayAfterThanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  dayAfterThanksgiving.setDate(dayAfterThanksgiving.getDate() + 1);
  addIfTradingDay(dayAfterThanksgiving);

  const christmasEve = new Date(year, 11, 24);
  addIfTradingDay(christmasEve);

  return earlyCloses;
}

export function getMarketScheduleStatus(now: Date = new Date()) {
  const etNow = toEasternDate(now);
  const etDateKey = toDateKey(etNow.getFullYear(), etNow.getMonth() + 1, etNow.getDate());
  const weekday = etNow.getDay();
  const minutes = getEtMinutes(etNow);
  const isWeekend = weekday === 0 || weekday === 6;
  const fullHolidayKeys = getFullMarketHolidayKeys(etNow.getFullYear());
  const isFullHoliday = fullHolidayKeys.has(etDateKey);
  const isMarketOpenDay = !isWeekend && !isFullHoliday;
  const isEarlyClose = isMarketOpenDay && getEarlyCloseMarketHolidayKeys(etNow.getFullYear(), fullHolidayKeys).has(etDateKey);
  const tradingEndMinutes = isEarlyClose ? 12 * 60 + 45 : 15 * 60 + 45;
  const auditMinutes = isEarlyClose ? 13 * 60 + 15 : 16 * 60 + 15;

  return {
    etNow,
    etDateKey,
    minutes,
    isMarketOpenDay,
    isEarlyClose,
    isTradingWindow: isMarketOpenDay && minutes >= 10 * 60 && minutes <= tradingEndMinutes,
    isAuditWindow: isMarketOpenDay && minutes === auditMinutes,
    skipReason: isWeekend ? 'weekend' : isFullHoliday ? 'us_market_holiday' : null
  };
}

function getConsecutiveLosses(actionLog: ActionLogItem[]) {
  let losses = 0;
  for (let i = actionLog.length - 1; i >= 0; i--) {
    const pnl = actionLog[i].pnl;
    if (pnl == null) continue;
    if (pnl < 0) losses++;
    else break;
  }
  return losses;
}

function getDailyPnlPoints(actionLog: ActionLogItem[]) {
  return actionLog.reduce((sum, item) => sum + (item.pnl || 0), 0);
}

function hasUnverifiedMacroEventRisk(sentimentData: any) {
  const text = `${sentimentData?.label || ""} ${sentimentData?.reason || ""}`.toLowerCase();
  return /\b(cpi|fomc|fed|powell|nfp|jobs report|payroll|inflation|rate decision)\b/.test(text);
}

function bucketLevel(price: number, bucketSize = 5) {
  return Math.round(price / bucketSize) * bucketSize;
}

function buildKeyLevels(prices: number[], currentPrice: number, kind: "support" | "resistance"): IntradayKeyLevel[] {
  const counts = new Map<number, number>();
  for (const price of prices) {
    if (!Number.isFinite(price)) continue;
    const level = bucketLevel(price);
    counts.set(level, (counts.get(level) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([level, touches]) => ({
      level,
      touches,
      kind,
      distance: Math.abs(currentPrice - level)
    }))
    .filter((item) => item.touches >= 2)
    .sort((a, b) => b.touches - a.touches || a.distance - b.distance);
}

function getNearestLevel(levels: IntradayKeyLevel[], currentPrice: number, direction: "below" | "above") {
  const filtered = levels
    .filter((level) => direction === "below" ? level.level <= currentPrice : level.level >= currentPrice)
    .sort((a, b) => a.distance - b.distance || b.touches - a.touches);
  return filtered[0] || null;
}

function computeIntradayStructureContext(m5Quotes: any[], currentPrice: number): IntradayStructureContext {
  const validQuotes = m5Quotes
    .filter((q: any) => q?.high != null && q?.low != null && q?.close != null)
    .slice(-72);

  if (validQuotes.length < 18 || !Number.isFinite(currentPrice)) {
    return {
      nearestSupport: null,
      nearestResistance: null,
      repeatedSupport: null,
      repeatedResistance: null,
      targetDisciplineNote: "5分鐘資料不足，止盈止損先跟 VWAP/EMA9 同 GEX 關鍵位。"
    };
  }

  const supports = buildKeyLevels(validQuotes.map((q: any) => Number(q.low)), currentPrice, "support");
  const resistances = buildKeyLevels(validQuotes.map((q: any) => Number(q.high)), currentPrice, "resistance");
  const nearestSupport = getNearestLevel(supports, currentPrice, "below");
  const nearestResistance = getNearestLevel(resistances, currentPrice, "above");
  const repeatedSupport = supports.find((level) => level.level <= currentPrice && level.touches >= 3) || null;
  const repeatedResistance = resistances.find((level) => level.level >= currentPrice && level.touches >= 3) || null;

  const notes: string[] = [];
  if (repeatedSupport) {
    notes.push(`${repeatedSupport.level} 附近係重複支撐，已經守住 ${repeatedSupport.touches} 次；做 PUT 要先喺支撐前收割，除非價格明確跌穿並企穩下面。`);
  }
  if (repeatedResistance) {
    notes.push(`${repeatedResistance.level} 附近係重複阻力，已經壓住 ${repeatedResistance.touches} 次；做 CALL 要先喺阻力前收割，除非價格明確升穿並企穩上面。`);
  }

  return {
    nearestSupport,
    nearestResistance,
    repeatedSupport,
    repeatedResistance,
    targetDisciplineNote: notes.join(" ") || "暫時未見重複日內牆位，止盈用 GEX 牆位加 M5 trailing。"
  };
}

function appendPlanSnapshot(logItem: ActionLogItem, plan: any, ruleEngine: ZeroDteRuleEngineResult): ActionLogItem {
  return {
    ...logItem,
    buyZone: plan?.buy_zone,
    stopLoss: plan?.stop_loss,
    takeProfit: plan?.take_profit,
    riskWarning: plan?.risk_warning,
    ruleEngineVerdict: ruleEngine.verdict,
    signalScore: ruleEngine.signalScore
  };
}

function analyzeZeroDteRules(args: {
  etNow: Date;
  spxInd: any;
  m5Analysis: { volumeSurge: number; currentM5Vol?: number; avgM5Vol?: number };
  currentVix: number | null | undefined;
  currentVix9d: number | null | undefined;
  currentVix3m: number | null | undefined;
  pcrValue: number | null;
  calculatedGex: GexData | null;
  trendDayContext: TrendDayContext;
  intradayStructure: IntradayStructureContext;
  dailyMemory: DailyMemory;
  sentimentData: any;
  priceActionContext: any;
}): ZeroDteRuleEngineResult {
  const {
    etNow,
    spxInd,
    m5Analysis,
    currentVix,
    currentVix9d,
    currentVix3m,
    pcrValue,
    calculatedGex,
    trendDayContext,
    intradayStructure,
    dailyMemory,
    sentimentData,
    priceActionContext
  } = args;

  const hardBlocks: string[] = [];
  const activeRisks: string[] = [];
  let score = 45;

  const currentPrice = Number(spxInd.currentClose);
  const ema9 = spxInd.ema9 != null ? Number(spxInd.ema9) : null;
  const ema20 = spxInd.ema20 != null ? Number(spxInd.ema20) : null;
  const vwap = spxInd.currentVWAP != null ? Number(spxInd.currentVWAP) : null;
  const macdHistogram = spxInd.macd?.histogram != null ? Number(spxInd.macd.histogram) : null;
  const volumeSurge = Number(m5Analysis.volumeSurge || 1);
  const gammaFlip = calculatedGex?.gammaFlipLevel ? Number(calculatedGex.gammaFlipLevel) : null;

  const aboveVwap = vwap != null && currentPrice > vwap;
  const belowVwap = vwap != null && currentPrice < vwap;
  const emaBull = ema9 != null && ema20 != null && ema9 > ema20 && currentPrice > ema9;
  const emaBear = ema9 != null && ema20 != null && ema9 < ema20 && currentPrice < ema9;
  const macdBull = macdHistogram != null && macdHistogram > 0;
  const macdBear = macdHistogram != null && macdHistogram < 0;
  const aboveGammaFlip = gammaFlip != null ? currentPrice > gammaFlip : null;
  const nearGammaFlip = gammaFlip != null && Math.abs(currentPrice - gammaFlip) <= 8;
  const isTrendDay = trendDayContext.regime === "BULL_TREND_DAY" || trendDayContext.regime === "BEAR_TREND_DAY";
  const isNegativeGamma = calculatedGex?.zeroDteGammaStatus === "negative_gamma" || calculatedGex?.gammaStatus === "negative_gamma";
  const macroEventRisk = hasUnverifiedMacroEventRisk(sentimentData);
  const volumeReliable = Number(m5Analysis.avgM5Vol || 0) > 0 && Number(m5Analysis.currentM5Vol || 0) > 0;
  const gammaPinningDetected = Boolean(
    calculatedGex?.zeroDteGammaStatus === "positive_gamma" &&
    !isTrendDay &&
    (nearGammaFlip ||
      calculatedGex.longWalls?.some((w) => Math.abs(currentPrice - Number(w.strike)) <= 8))
  );
  const thetaDecayRiskHigh = dailyMemory.currentPosition !== "NONE" && getEtMinutes(etNow) >= 14 * 60 + 30;

  let callScore = 0;
  let putScore = 0;
  if (aboveVwap) callScore += 2;
  if (belowVwap) putScore += 2;
  if (emaBull) callScore += 2;
  if (emaBear) putScore += 2;
  if (macdBull) callScore += 1;
  if (macdBear) putScore += 1;
  if (aboveGammaFlip === true) callScore += 1;
  if (aboveGammaFlip === false) putScore += 1;
  if (trendDayContext.directionalBias === "CALL") callScore += 3;
  if (trendDayContext.directionalBias === "PUT") putScore += 3;
  if (priceActionContext?.macroTrend?.includes("UPTREND")) callScore += 1;
  if (priceActionContext?.macroTrend?.includes("DOWNTREND")) putScore += 1;

  const directionalBias: "CALL" | "PUT" | "NONE" =
    callScore >= putScore + 2 ? "CALL" : putScore >= callScore + 2 ? "PUT" : "NONE";

  if (directionalBias !== "NONE") score += 14;
  if (isTrendDay) score += 12;
  if (isNegativeGamma && directionalBias !== "NONE") score += 8;
  if (volumeReliable && volumeSurge >= 1.25) score += 8;
  else if (!volumeReliable && isTrendDay) {
    score += 4;
    activeRisks.push("index_volume_unavailable_using_price_trend");
  }
  else {
    score -= 8;
    activeRisks.push("volume_follow_through_weak");
  }
  if (calculatedGex) score += 8;
  else {
    score -= 12;
    activeRisks.push("gex_missing");
  }
  if (currentVix && currentVix9d && currentVix3m) score += 6;
  else {
    score -= 10;
    activeRisks.push("vix_term_structure_missing");
  }
  if (pcrValue != null) score += 4;
  else {
    score -= 5;
    activeRisks.push("pcr_missing");
  }
  if (gammaPinningDetected) {
    score -= 12;
    activeRisks.push("gamma_pinning_detected");
  }
  if (thetaDecayRiskHigh) {
    score -= 10;
    activeRisks.push("theta_decay_risk_high");
  }
  if (macroEventRisk && isTrendDay && directionalBias !== "NONE") {
    score += 6;
    activeRisks.push("macro_event_is_catalyst_verify_calendar");
  } else if (macroEventRisk) {
    score -= 10;
    activeRisks.push("macro_event_risk_unverified");
  }
  if (directionalBias === "NONE") {
    score -= 12;
    activeRisks.push("signal_conflict");
  }

  if (directionalBias === "PUT" && intradayStructure.repeatedSupport && intradayStructure.repeatedSupport.distance <= 12) {
    score -= 6;
    activeRisks.push(`put_target_near_repeated_support_${intradayStructure.repeatedSupport.level}`);
  }
  if (directionalBias === "CALL" && intradayStructure.repeatedResistance && intradayStructure.repeatedResistance.distance <= 12) {
    score -= 6;
    activeRisks.push(`call_target_near_repeated_resistance_${intradayStructure.repeatedResistance.level}`);
  }

  const minutesNow = getEtMinutes(etNow);
  const marketOpen = 9 * 60 + 30;
  if (minutesNow >= marketOpen && minutesNow < marketOpen + 5) {
    hardBlocks.push("first_5_minutes_no_chasing");
  }
  const consecutiveLosses = getConsecutiveLosses(dailyMemory.actionLog);
  const dailyPnlPoints = getDailyPnlPoints(dailyMemory.actionLog);
  if (consecutiveLosses >= 3 || dailyPnlPoints <= -30) {
    hardBlocks.push("daily_circuit_breaker");
  }

  let positionTimedOut = false;
  if (dailyMemory.currentPosition !== "NONE" && dailyMemory.entryPrice != null) {
    const entryDate = parseEtTimestamp(dailyMemory.entryTime);
    const elapsedMinutes = entryDate ? (etNow.getTime() - entryDate.getTime()) / 60000 : null;
    const expectedMove =
      dailyMemory.currentPosition === "CALL"
        ? currentPrice - dailyMemory.entryPrice
        : dailyMemory.entryPrice - currentPrice;
    if (elapsedMinutes != null && elapsedMinutes >= 15 && expectedMove <= 0) {
      positionTimedOut = true;
      hardBlocks.push("position_no_follow_through_after_15m");
    }
  }

  score = clampNumber(Math.round(score), 0, 100);

  let marketRegime: ZeroDteRuleEngineResult["marketRegime"] = "UNKNOWN";
  if (gammaPinningDetected) marketRegime = "GAMMA_PIN";
  else if (trendDayContext.regime === "BULL_TREND_DAY" || trendDayContext.regime === "BEAR_TREND_DAY") marketRegime = "TREND";
  else if (trendDayContext.regime === "RANGE_OR_MIXED") marketRegime = "CHOP";

  let verdict: ZeroDteAdvisoryVerdict = "WAIT_AND_OBSERVE";
  if (positionTimedOut) verdict = "CLOSE_OR_REDUCE_SUGGESTED";
  else if (hardBlocks.includes("daily_circuit_breaker")) verdict = "FREEZE_NEW_SIGNALS";
  else if (hardBlocks.length > 0 || score < 45) verdict = "NO_TRADE";
  else if (
    directionalBias !== "NONE" &&
    (score >= 70 || (isTrendDay && score >= 62) || (isNegativeGamma && score >= 62))
  ) verdict = "TRADE_ALLOWED";

  return {
    verdict,
    directionalBias,
    marketRegime,
    signalScore: score,
    hardBlocks,
    activeRisks,
    allowNewSignal: verdict === "TRADE_ALLOWED",
    hardRuleTriggered: hardBlocks.length > 0,
    thetaDecayRiskHigh,
    gammaPinningDetected,
    liquidityRisk: "UNKNOWN"
  };
}

// --- IC-specific Agent Analyzer ---
async function analyzeWithICAgent(personaPrompt: string, contextData: any, env: Env) {
  const systemPrompt = `You are an institutional options strategist. Your persona is: ${personaPrompt}. \n${SYSTEM_PROMPT_IC}`;

  try {
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://spx-trading-pua.kungsiuchun0.workers.dev',
        'X-OpenRouter-Title': 'SPX PUA Agent'
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Market Data Context: ${JSON.stringify(contextData)}` }
        ]
      })
    }, 15000);

    if (!response.ok) {
      return { ic_action: 'STAND_DOWN', ic_reasoning: '接口錯誤', gex_check: 'N/A', vix_check: 'N/A', event_check: 'N/A' };
    }
    const data = await response.json() as any;
    let content = data.choices[0].message.content;
    content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(content);
  } catch (e: any) {
    console.error('IC Agent error:', e.message);
    return { ic_action: 'STAND_DOWN', ic_reasoning: '分析失敗', gex_check: 'N/A', vix_check: 'N/A', event_check: 'N/A' };
  }
}

async function analyzeWithAgent(personaKey: string, personaPrompt: string, contextData: any, env: Env) {
  const systemPrompt = `You are an elite stock trader. Your persona is: ${personaPrompt}. \n${SYSTEM_PROMPT_PREFIX}`;

  try {
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://spx-trading-pua.kungsiuchun0.workers.dev',
        'X-OpenRouter-Title': 'SPX PUA Agent'
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Market Data Context: ${JSON.stringify(contextData)}` }
        ]
      })
    }, 15000);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenRouter Error ${response.status}:`, errorText);
      return { decision: "HOLD", reasoning: `接口錯誤(${response.status})`, analysis: "數據獲取失敗" };
    }
    const data = await response.json() as any;
    let content = data.choices[0].message.content;


    content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(content);
    return { ...parsed, analysis: parsed.reasoning || "" };
  } catch (e: any) {
    console.error('Agent error:', e.message);
    return { decision: "HOLD", reasoning: "分析失敗", analysis: "解析失敗" };
  }
}

async function sendTelegramMessage(token: string, chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const resData = await res.json() as any;
    if (!res.ok) {
      console.error(`Telegram Error: ${res.status}`, JSON.stringify(resData));
      return false;
    }
    console.log('Telegram Success');
    return true;
  } catch (e: any) {
    console.error('Telegram Fetch System Error:', e.message);
    return false;
  }
}

function tgEscape(str: string): string {
  if (!str) return "";
  // 處理 AI 返回的字面 "\n" 符號，將其轉換為真實的換行
  return str.replace(/\\n/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- 主要執行邏輯 ---

async function persistRecapDayToD1(env: Env, date: string, memory: DailyMemory, audit?: {
  report: string;
  learnedRules: string[];
  generatedAt?: string | null;
}) {
  if (!env.SPX_RECAP_DB) return;

  try {
    await upsertRecapDay(env.SPX_RECAP_DB, date, memory, audit ? {
      date,
      generatedAt: audit.generatedAt || new Date().toISOString(),
      report: audit.report,
      learnedRules: audit.learnedRules,
      actionLogSize: memory.actionLog.length
    } : null);
    console.log('[D1] SPX recap persisted', date);
  } catch (err: any) {
    console.error('[D1] SPX recap persist failed', err?.message || err);
  }
}

async function runTradingAgents(env: Env, now: Date = new Date(), options: ScheduledRunOptions = {}) {
  try {
    const marketStatus = getMarketScheduleStatus(now);
    if (!options.force && !marketStatus.isTradingWindow) {
      console.log(`[SCHEDULE] Skip trading run: ${marketStatus.skipReason || 'outside_trading_window'} ${marketStatus.etDateKey} ${marketStatus.minutes}`);
      return;
    }

    // 0. 密鑰效驗 (PUA 診斷)
    if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) {
      throw new Error(`環境變量缺失: TOKEN=${!!env.TELEGRAM_TOKEN}, CHAT=${!!env.TELEGRAM_CHAT_ID}`);
    }

    console.log('[DEBUG] 💓 任務啟動：發送心跳...');
    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, "💓 <b>系統心跳：診斷任務已啟動...</b>\n正在獲取市場數據中...");

    // Memory Fetch
    const etNow = marketStatus.etNow;
    const etDateStr = etNow.getFullYear() + "-" + (etNow.getMonth() + 1).toString().padStart(2, '0') + "-" + etNow.getDate().toString().padStart(2, '0');
    const memoryKey = `spx_memory_${etDateStr}`;

    const etTime = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(now);

    // 並行讀取日內記憶
    const rawMemory = await env.SPX_MEMORY.get(memoryKey);
    let dailyMemory: DailyMemory = rawMemory ? JSON.parse(rawMemory) : { currentPosition: "NONE", entryPrice: null, entryTime: null, actionLog: [], icPosition: "NONE", icDeployTime: null, icAction: null };
    // Ensure IC fields exist for legacy memory
    if (!dailyMemory.icPosition) { dailyMemory.icPosition = 'NONE'; dailyMemory.icDeployTime = null; dailyMemory.icAction = null; }

    console.log('[DEBUG] Step 1: Fetching Yahoo Quotes, Options, News, GEX & Multi-TF data...');
    const [spxQuotes, spxQuotesM5, spxQuotesD1, spxQuotesH1, vixQuotes, vixQuotes3mo, vixQuotes9d, spyQuotes, iwmQuotes, xlkQuotes, xlvQuotes, pcrValue, sentimentData, calculatedGex] = await Promise.all([
      fetchYahooChart('^GSPC', '15m', '7d'),
      fetchYahooChart('^GSPC', '5m', '2d'),
      fetchYahooChart('^GSPC', '1d', '3mo'),   // PA: D1 macro structure
      fetchYahooChart('^GSPC', '1h', '10d'),    // PA: 1H Order Blocks & FVG
      fetchYahooChart('^VIX', '15m', '7d'),
      fetchYahooChart('^VIX', '1d', '3mo'),     // IC: IV Percentile baseline
      fetchYahooChart('^VIX9D', '1d', '3mo'),   // VIX Term Structure
      fetchYahooChart('SPY', '1d', '5d'),       // ETF Flow
      fetchYahooChart('IWM', '1d', '5d'),       // ETF Flow
      fetchYahooChart('XLK', '1d', '5d'),       // ETF Flow
      fetchYahooChart('XLV', '1d', '5d'),       // ETF Flow
      fetchYahooOptionsPCR('^SPX'),
      fetchNewsAndSentiment(env),
      fetchAndCalculateGEX()
    ]);

    console.log('[DEBUG] Step 2: Calculating Indicators...');
    const spxInd = await calculateIndicators(spxQuotes);
    const currentVix = vixQuotes[vixQuotes.length - 1]?.close;

    if (!spxInd) {
      throw new Error('無法計算技術指標');
    }

    const m5QuotesValid = spxQuotesM5.filter((q: any) => q.close !== null);
    const m5QuotesWithVol = m5QuotesValid.filter((q: any) => (q.volume || 0) > 0);

    let m5Analysis = { boxHigh: 0, boxLow: 0, volumeSurge: 1, currentM5Vol: 0, avgM5Vol: 0 };
    if (m5QuotesValid.length >= 24) {
      const last24 = m5QuotesValid.slice(-24); // 2 hours
      m5Analysis.boxHigh = Math.max(...last24.map((q: any) => q.high));
      m5Analysis.boxLow = Math.min(...last24.map((q: any) => q.low));
    }
    if (m5QuotesWithVol.length >= 11) {
      const last10 = m5QuotesWithVol.slice(-11, -1);
      m5Analysis.avgM5Vol = last10.reduce((sum: number, q: any) => sum + (q.volume || 0), 0) / 10;
      m5Analysis.currentM5Vol = m5QuotesWithVol[m5QuotesWithVol.length - 1].volume || 0;
      m5Analysis.volumeSurge = m5Analysis.avgM5Vol > 0 ? (m5Analysis.currentM5Vol / m5Analysis.avgM5Vol) : 1;
    }

    const pcrStatus = !pcrValue ? '數據缺失' : (pcrValue > 1.25 ? '⚠️ 極度恐慌避險 (反轉契機)' : pcrValue < 0.8 ? '極度貪婪 (回調風險)' : '情緒中性');

    const context = {
      asset: 'SPX',
      currentPrice: spxInd.currentClose.toFixed(2),
      volume: spxInd.volume,
      rsi14: spxInd.currentRSI.toFixed(2),
      bollingerBandwidth: spxInd.bandwidth.toFixed(2) + '%',
      isSqueeze: spxInd.isSqueeze,
      currentVix: currentVix?.toFixed(2),
      recentHigh: spxInd.recentHigh,
      recentLow: spxInd.recentLow,
      ema9: spxInd.ema9?.toFixed(2),
      ema20: spxInd.ema20?.toFixed(2),
      ema9Trend: spxInd.currentClose > (spxInd.ema9 || 0) ? 'Bullish (Above EMA9)' : 'Bearish (Below EMA9)',
      currentVWAP: spxInd.currentVWAP.toFixed(2),
      vwapDeviation: spxInd.vwapDeviation.toFixed(2) + '%',
      pcrValue: pcrValue ? pcrValue.toFixed(2) : 'N/A',
      pcrStatus: pcrStatus
    };

    const currentVix9d = vixQuotes9d[vixQuotes9d.length - 1]?.close;
    const currentVix3m = vixQuotes3mo[vixQuotes3mo.length - 1]?.close;
    let vixTermStructure = "N/A";
    if (currentVix9d && currentVix && currentVix3m) {
      if (currentVix9d < currentVix && currentVix < currentVix3m) vixTermStructure = "Contango (Normal)";
      else if (currentVix9d > currentVix && currentVix > currentVix3m) vixTermStructure = "Backwardation (Panic)";
      else vixTermStructure = "Mixed/Flat";
    }

    const etfQuotes = {
      'SPY': spyQuotes,
      'IWM': iwmQuotes,
      'XLK': xlkQuotes,
      'XLV': xlvQuotes
    };
    const fundFlow = await getFundFlow(spxQuotes, etfQuotes);

    // GEX 整合到 AI context
    const calculatedGexContext = calculatedGex ? {
      source: `Internal Yahoo Options GEX Calculator (${calculatedGex.generatedAt})`,
      gammaFlipLevel: calculatedGex.gammaFlipLevel,
      gammaStatus: calculatedGex.gammaStatus,
      broadGammaStatus: calculatedGex.broadGammaStatus,
      zeroDteGammaStatus: calculatedGex.zeroDteGammaStatus,
      totalNetGex: calculatedGex.totalNetGex,
      zeroDteNetGex: calculatedGex.zeroDteNetGex,
      mostLongGammaStrike: `${calculatedGex.mostLongStrike} (${calculatedGex.mostLongGex})`,
      mostShortGammaStrike: `${calculatedGex.mostShortStrike} (${calculatedGex.mostShortGex})`,
      longGammaWalls: calculatedGex.longWalls?.map((w: any) => `${w.strike}(${w.gex})`).join(' > '),
      shortGammaPockets: calculatedGex.shortPockets?.map((p: any) => `${p.strike}(${p.gex})`).join(' > '),
    } : null;
    const trendDayContext = computeTrendDayContext(m5QuotesValid, spxInd, calculatedGex);
    const priceActionContext = calculatePriceActionContext(spxQuotesD1, spxQuotesH1);
    const intradayStructure = computeIntradayStructureContext(m5QuotesValid, spxInd.currentClose);
    const zeroDteRuleEngine = analyzeZeroDteRules({
      etNow,
      spxInd,
      m5Analysis,
      currentVix,
      currentVix9d,
      currentVix3m,
      pcrValue,
      calculatedGex,
      trendDayContext,
      intradayStructure,
      dailyMemory,
      sentimentData,
      priceActionContext
    });

    const rawWisdom = await env.SPX_MEMORY.get('SPX_WISDOM_BOOK');
    const learnedRules = rawWisdom ? JSON.parse(rawWisdom) : [];

    const extendedContext = {
      currentTime: etTime,
      ...context,
      macd: spxInd.macd,
      fundFlow,
      learned_rules: learnedRules,
      m5Analysis: {
        boxHigh: m5Analysis.boxHigh.toFixed(2),
        boxLow: m5Analysis.boxLow.toFixed(2),
        volumeSurge: m5Analysis.volumeSurge.toFixed(2) + 'x',
      },
      newsSentiment: {
        score: sentimentData.score,
        label: sentimentData.label,
        reason: sentimentData.reason
      },
      trendDayContext,
      intradayStructure,
      zeroDteRuleEngine,
      calculatedGEX: calculatedGexContext,
      priceActionContext,
      TODAYS_MEMORY: {
        currentPosition: dailyMemory.currentPosition,
        entryPrice: dailyMemory.entryPrice,
        recentActions: dailyMemory.actionLog.slice(-3),
        icPosition: dailyMemory.icPosition,
      }
    };

    // IC Agent gets its own focused context
    const ivPercentile = calculateIVPercentile(vixQuotes3mo);
    const icContext = {
      currentTime: etTime,
      currentPrice: context.currentPrice,
      currentVix: context.currentVix,
      ivPercentile,
      pcrValue: context.pcrValue,
      calculatedGEX: calculatedGexContext,
      trendDayContext,
      zeroDteRuleEngine,
      icPositionStatus: dailyMemory.icPosition,
      newsSentiment: sentimentData,
    };

    console.log('[DEBUG] Step 3: Triggering 5 AI Agents (QM/CM/NT/PA + IC)...');
    const [agent1, agent2, agent3, agent4, agentIC] = await Promise.all([
      analyzeWithAgent('QM', PERSONAS.QM_MOMENTUM_SNIPER, extendedContext, env),
      analyzeWithAgent('CM', PERSONAS.CM_OPTIONS_MAKER, extendedContext, env),
      analyzeWithAgent('NT', PERSONAS.NT_MACRO_SENTIMENT, extendedContext, env),
      analyzeWithAgent('PA', PERSONAS.PA_PRICE_ACTION, extendedContext, env),
      analyzeWithICAgent(PERSONAS.IC_IRON_CONDOR, icContext, env)
    ]);

    const normalizeDecision = (d: string) => d ? d.toString().trim().toUpperCase() : "HOLD";
    const d1 = normalizeDecision(agent1.decision);
    const d2 = normalizeDecision(agent2.decision);
    const d3 = normalizeDecision(agent3.decision);
    const d4 = normalizeDecision(agent4.decision);
    const formatAgentDecision = (decision: string) => {
      if (['BUY', 'LONG', 'CALL', 'OPEN_CALL'].includes(decision)) return '🟢 [做多]';
      if (['SELL', 'SHORT', 'PUT', 'OPEN_PUT'].includes(decision)) return '🔴 [做空]';
      return '⚪ [觀望]';
    };

    const buyVotes = [d1, d2, d3, d4].filter(d => d === 'BUY' || d === 'LONG').length;
    const sellVotes = [d1, d2, d3, d4].filter(d => d === 'SELL' || d === 'SHORT' || d === 'PUT').length;
    const holdVotes = 4 - buyVotes - sellVotes;
    let consensusVote = buyVotes > sellVotes ? 'LONG 📈' : sellVotes > buyVotes ? 'SHORT 📉' : 'NEUTRAL ⚖️';

    console.log('[DEBUG] Step 4: Triggering Orchestrator...');
    let orchestratorPlan = { strategy: '觀望 (Hold)', logic: '無法取得總結邏輯', risk_management: '嚴控風險。' };
    try {
      const orchRes = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
          messages: [
            { role: 'system', content: ORCHESTRATOR_PROMPT },
            { role: 'user', content: `Market Context: ${JSON.stringify(extendedContext)}\nQM (Momentum): ${JSON.stringify(agent1)}\nCM (GEX): ${JSON.stringify(agent2)}\nNT (Sentiment): ${JSON.stringify(agent3)}\nPA (Price Action): ${JSON.stringify(agent4)}\nIC (Iron Condor): ${JSON.stringify(agentIC)}` }
          ]
        })
      }, 20000);
      if (orchRes.ok) {
        const orchData = await orchRes.json() as any;
        let content = orchData.choices[0].message.content;
        content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
        orchestratorPlan = JSON.parse(content);
      }
    } catch (e) {
      console.error('[ERR] Orchestrator error', e);
    }

    const callTargetGuide = intradayStructure.repeatedResistance
      ? `先在重複阻力 ${intradayStructure.repeatedResistance.level} 前分段止盈；有效接受其上方後才看下一道 GEX wall。`
      : (calculatedGex?.mostLongStrike ? `先看 SG_High / long wall ${calculatedGex.mostLongStrike}，突破後用 M5 higher-low trailing。` : '用 M5 higher-low trailing，失去 VWAP 即撤。');
    const putTargetGuide = intradayStructure.repeatedSupport
      ? `先在重複支撐 ${intradayStructure.repeatedSupport.level} 前分段止盈；有效接受其下方後才看下一道 GEX pocket。`
      : (calculatedGex?.mostShortStrike ? `先看 SG_Low / short pocket ${calculatedGex.mostShortStrike}，跌破後用 M5 lower-high trailing。` : '用 M5 lower-high trailing，收復 VWAP 即撤。');

    if (
      dailyMemory.currentPosition === 'NONE' &&
      isBeforeEtCutoff(etNow, 15, 30) &&
      trendDayContext.regime === 'BULL_TREND_DAY' &&
      (((orchestratorPlan as any).trade_action || 'HOLD') === 'HOLD' || (orchestratorPlan as any).trade_action === 'OPEN_PUT')
    ) {
      orchestratorPlan = {
        ...(orchestratorPlan as any),
        trade_action: 'OPEN_CALL',
        action_reasoning: '順勢追蹤',
        logic: trendDayContext.rationale,
        buy_zone: `單邊上升日 override：現價 ${spxInd.currentClose.toFixed(2)} 附近跟隨 CALL；必須守住 VWAP ${spxInd.currentVWAP.toFixed(2)} / EMA9 ${spxInd.ema9?.toFixed(2) ?? 'N/A'}。`,
        stop_loss: `跌回 VWAP ${spxInd.currentVWAP.toFixed(2)} 並失守 EMA9，單邊日假設失效。`,
        take_profit: callTargetGuide,
        risk_warning: '主要風險係尾盤追高同 VWAP 假跌破；但原本 HOLD 會錯失單邊趨勢。'
      };
    } else if (
      dailyMemory.currentPosition === 'NONE' &&
      isBeforeEtCutoff(etNow, 15, 30) &&
      trendDayContext.regime === 'BEAR_TREND_DAY' &&
      (((orchestratorPlan as any).trade_action || 'HOLD') === 'HOLD' || (orchestratorPlan as any).trade_action === 'OPEN_CALL')
    ) {
      orchestratorPlan = {
        ...(orchestratorPlan as any),
        trade_action: 'OPEN_PUT',
        action_reasoning: '順勢追蹤',
        logic: trendDayContext.rationale,
        buy_zone: `單邊下跌日 override：現價 ${spxInd.currentClose.toFixed(2)} 附近跟隨 PUT；必須壓在 VWAP ${spxInd.currentVWAP.toFixed(2)} / EMA9 ${spxInd.ema9?.toFixed(2) ?? 'N/A'} 下方。`,
        stop_loss: `站回 VWAP ${spxInd.currentVWAP.toFixed(2)} 並收復 EMA9，單邊日假設失效。`,
        take_profit: putTargetGuide,
        risk_warning: '主要風險係尾盤追空同 VWAP 假收復；但原本 HOLD 會錯失單邊趨勢。'
      };
    }

    const plannedTradeAction = ((orchestratorPlan as any).trade_action || 'HOLD').toString().toUpperCase();
    const mustBlockNewDirectionalSignal =
      zeroDteRuleEngine.hardRuleTriggered ||
      zeroDteRuleEngine.verdict === 'FREEZE_NEW_SIGNALS' ||
      (zeroDteRuleEngine.verdict === 'NO_TRADE' && zeroDteRuleEngine.signalScore < 45) ||
      (zeroDteRuleEngine.gammaPinningDetected && trendDayContext.regime === 'RANGE_OR_MIXED') ||
      zeroDteRuleEngine.directionalBias === 'NONE';
    if (zeroDteRuleEngine.verdict === 'CLOSE_OR_REDUCE_SUGGESTED' && dailyMemory.currentPosition !== 'NONE') {
      orchestratorPlan = {
        ...(orchestratorPlan as any),
        trade_action: 'CLOSE',
        action_reasoning: '0DTE風控',
        buy_zone: 'N/A',
        stop_loss: '0DTE rule engine: 15分鐘內無順向跟進，Theta decay 風險升高。',
        take_profit: '先退出或減倉，等待下一個高分 setup。',
        risk_warning: `Hard rule triggered: ${zeroDteRuleEngine.hardBlocks.join(', ') || 'position_timeout'}`
      };
    } else if (
      dailyMemory.currentPosition === 'NONE' &&
      ['OPEN_CALL', 'OPEN_PUT'].includes(plannedTradeAction) &&
      zeroDteRuleEngine.verdict !== 'TRADE_ALLOWED' &&
      mustBlockNewDirectionalSignal
    ) {
      orchestratorPlan = {
        ...(orchestratorPlan as any),
        trade_action: 'HOLD',
        action_reasoning: '0DTE禁開',
        buy_zone: 'N/A',
        stop_loss: 'N/A',
        take_profit: 'N/A',
        risk_warning: `0DTE rule engine hard-blocked new signal: ${zeroDteRuleEngine.verdict}. ${zeroDteRuleEngine.hardBlocks.join(', ') || zeroDteRuleEngine.activeRisks.join(', ') || 'score_not_enough'}`
      };
    }

    const finalPlannedAction = ((orchestratorPlan as any).trade_action || 'HOLD').toString().toUpperCase();
    if (finalPlannedAction === 'OPEN_PUT' && intradayStructure.repeatedSupport) {
      orchestratorPlan = {
        ...(orchestratorPlan as any),
        take_profit: `${(orchestratorPlan as any).take_profit || 'N/A'} | Adaptive guard: ${intradayStructure.repeatedSupport.level} 是 M5 重複支撐，未接受下破前先收割，禁止死等更遠目標。`,
        risk_warning: `${(orchestratorPlan as any).risk_warning || ''} 重複支撐會製造反抽，PUT 要用 trailing stop。`.trim()
      };
    } else if (finalPlannedAction === 'OPEN_CALL' && intradayStructure.repeatedResistance) {
      orchestratorPlan = {
        ...(orchestratorPlan as any),
        take_profit: `${(orchestratorPlan as any).take_profit || 'N/A'} | Adaptive guard: ${intradayStructure.repeatedResistance.level} 是 M5 重複阻力，未接受上破前先收割，禁止死等更遠目標。`,
        risk_warning: `${(orchestratorPlan as any).risk_warning || ''} 重複阻力會製造回吐，CALL 要用 trailing stop。`.trim()
      };
    }

    // Update Memory based on Action
    const tradeAction = (orchestratorPlan as any).trade_action || "HOLD";
    const currentPriceStr = spxInd.currentClose;

    if (tradeAction === 'OPEN_CALL' && dailyMemory.currentPosition === 'NONE') {
      dailyMemory.currentPosition = 'CALL';
      dailyMemory.entryPrice = currentPriceStr;
      dailyMemory.entryTime = etTime;
      dailyMemory.actionLog.push(appendPlanSnapshot({ time: etTime, price: currentPriceStr, action: '買入 Call', reasoning: planReason(orchestratorPlan) }, orchestratorPlan, zeroDteRuleEngine));
    } else if (tradeAction === 'OPEN_PUT' && dailyMemory.currentPosition === 'NONE') {
      dailyMemory.currentPosition = 'PUT';
      dailyMemory.entryPrice = currentPriceStr;
      dailyMemory.entryTime = etTime;
      dailyMemory.actionLog.push(appendPlanSnapshot({ time: etTime, price: currentPriceStr, action: '買入 Put', reasoning: planReason(orchestratorPlan) }, orchestratorPlan, zeroDteRuleEngine));
    } else if (tradeAction === 'CLOSE' && dailyMemory.currentPosition !== 'NONE') {
      const pnlRaw = dailyMemory.currentPosition === 'CALL'
        ? (currentPriceStr - dailyMemory.entryPrice!)
        : (dailyMemory.entryPrice! - currentPriceStr);
      dailyMemory.actionLog.push(appendPlanSnapshot({
        time: etTime,
        price: currentPriceStr,
        action: `平倉 ${dailyMemory.currentPosition}`,
        reasoning: planReason(orchestratorPlan),
        pnl: parseFloat(pnlRaw.toFixed(2))
      }, orchestratorPlan, zeroDteRuleEngine));
      dailyMemory.currentPosition = 'NONE';
      dailyMemory.entryPrice = null;
      dailyMemory.entryTime = null;
    } else if (tradeAction === 'HOLD' && dailyMemory.currentPosition === 'NONE') {
      dailyMemory.actionLog.push(appendPlanSnapshot({ time: etTime, price: currentPriceStr, action: '觀望防守', reasoning: planReason(orchestratorPlan) }, orchestratorPlan, zeroDteRuleEngine));
    }

    // Update IC Position Memory
    let icAction = agentIC.ic_action || (orchestratorPlan as any).iron_condor_assessment || 'STAND_DOWN';
    if (zeroDteRuleEngine.verdict !== 'TRADE_ALLOWED' && icAction === 'DEPLOY') {
      icAction = 'STAND_DOWN';
      agentIC.ic_action = 'STAND_DOWN';
      agentIC.event_check = zeroDteRuleEngine.hardBlocks.length > 0 ? 'FAIL' : agentIC.event_check;
      agentIC.ic_reasoning = `0DTE rule engine blocked IC deployment: ${zeroDteRuleEngine.verdict}. ${zeroDteRuleEngine.hardBlocks.join(', ') || zeroDteRuleEngine.activeRisks.join(', ') || 'score_not_enough'}`;
    } else if (!trendDayContext.icAllowed && icAction === 'DEPLOY') {
      icAction = 'STAND_DOWN';
      agentIC.ic_action = 'STAND_DOWN';
      agentIC.gex_check = 'FAIL';
      agentIC.ic_reasoning = `${trendDayContext.icBlockReason} ${trendDayContext.rationale}`;
    } else if (!trendDayContext.icAllowed && dailyMemory.icPosition !== 'NONE' && !['CLOSE_WING', 'CLOSE_50PCT', 'EMERGENCY_CLOSE'].includes(icAction)) {
      icAction = 'EMERGENCY_CLOSE';
      agentIC.ic_action = 'EMERGENCY_CLOSE';
      agentIC.gex_check = 'FAIL';
      agentIC.ic_reasoning = `${trendDayContext.icBlockReason} ${trendDayContext.rationale}`;
    }
    if (icAction === 'DEPLOY' && dailyMemory.icPosition === 'NONE') {
      dailyMemory.icPosition = 'DEPLOYED';
      dailyMemory.icDeployTime = etTime;
      dailyMemory.icAction = icAction;
      dailyMemory.actionLog.push({ time: etTime, price: currentPriceStr, action: '🦅 鐵鷹部署(0DTE)', reasoning: agentIC.ic_reasoning || 'IC Deploy' });
    } else if (icAction === 'CLOSE_WING' && dailyMemory.icPosition === 'DEPLOYED') {
      dailyMemory.icPosition = 'PARTIAL';
      dailyMemory.icAction = icAction;
      dailyMemory.actionLog.push({ time: etTime, price: currentPriceStr, action: '🦅 鐵鷹單邊平倉', reasoning: agentIC.ic_reasoning || 'IC Close Wing' });
    } else if (icAction === 'EMERGENCY_CLOSE' && dailyMemory.icPosition !== 'NONE') {
      dailyMemory.icPosition = 'NONE';
      dailyMemory.icDeployTime = null;
      dailyMemory.icAction = null;
      dailyMemory.actionLog.push({ time: etTime, price: currentPriceStr, action: '🦅 鐵鷹緊急撤退', reasoning: agentIC.ic_reasoning || 'IC Emergency Close' });
    } else if (icAction === 'CLOSE_50PCT' && dailyMemory.icPosition !== 'NONE') {
      dailyMemory.icPosition = 'NONE';
      dailyMemory.icDeployTime = null;
      dailyMemory.icAction = null;
      dailyMemory.actionLog.push({ time: etTime, price: currentPriceStr, action: '🦅 鐵鷹獲利平倉(50%)', reasoning: agentIC.ic_reasoning || 'IC Close 50%' });
    }

    // Save Memory
    const etNowDateStr = etTime.split(' ')[0].replace(/\//g, '-');
    const dbKey = `spx_memory_${etNowDateStr}`;
    await env.SPX_MEMORY.put(dbKey, JSON.stringify(dailyMemory));
    await persistRecapDayToD1(env, etNowDateStr, dailyMemory);

    const toM = (val: number) => (val / 1000000).toFixed(1) + 'M';
    let displayAction = tradeAction;
    if (tradeAction === 'OPEN_CALL') displayAction = '買入 Call';
    else if (tradeAction === 'OPEN_PUT') displayAction = '買入 Put';
    else if (tradeAction === 'CLOSE') displayAction = '平倉了結';
    else if (tradeAction === 'HOLD') displayAction = dailyMemory.currentPosition !== 'NONE' ? '持倉續抱' : '觀望空倉';

    const actionReasoning = (orchestratorPlan as any).action_reasoning || "策略執行";
    const finalDisplayAction = `${displayAction} (${actionReasoning})`;

    // PA Context summary for display
    const paCtx = extendedContext.priceActionContext;
    const currentPriceNum = Number(context.currentPrice);
    const parsePriceZone = (text: string | undefined) => {
      if (!text || text === 'None detected') return null;
      const match = text.match(/\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\]/);
      if (!match) return null;
      return { low: Number(match[1]), high: Number(match[2]) };
    };
    const zoneStatus = (label: string, text: string | undefined) => {
      const zone = parsePriceZone(text);
      if (!zone) return `${label}：未偵測`;
      if (currentPriceNum >= zone.low && currentPriceNum <= zone.high) return `${label}：<code>${zone.low.toFixed(2)}-${zone.high.toFixed(2)}</code>（現價正在區內）`;
      const distance = currentPriceNum < zone.low ? zone.low - currentPriceNum : currentPriceNum - zone.high;
      const direction = currentPriceNum < zone.low ? '區間在現價上方' : '區間在現價下方';
      return `${label}：<code>${zone.low.toFixed(2)}-${zone.high.toFixed(2)}</code>（距現價 ${distance.toFixed(2)} 點，${direction}）`;
    };
    const paBias = paCtx?.macroTrend?.includes('UPTREND')
      ? '偏多，日線仍是 HH/HL 升勢'
      : paCtx?.macroTrend?.includes('DOWNTREND')
        ? '偏空，日線仍是 LH/LL 跌勢'
        : '震盪，日線未有清晰方向';
    const paStructure = paCtx?.recentCHoCH
      ? '⚠️ 出現 CHoCH（性質變化），原趨勢有反轉警號'
      : paCtx?.recentBOS
        ? '✅ 出現 BOS（結構突破），原趨勢仍在延續'
        : '— 未見新突破，等價格靠近關鍵區';
    const paConclusion = paCtx
      ? (paCtx.recentCHoCH
        ? '結論：先降槓桿，等反轉確認或重新站回結構。'
        : paCtx.recentBOS
          ? '結論：PA 支持順勢背景；入場仍要等 0DTE / GEX / 動能共振。'
          : '結論：只係背景參考，未提供即時入場觸發。')
      : '';
    const paContextDisplay = paCtx
      ? `日線：${paBias}
結構：${paStructure}
關鍵區：${zoneStatus('OB 回踩區', paCtx.nearestOB)} | ${zoneStatus('FVG 缺口', paCtx.nearestFVG)}
黃金口袋：<code>${paCtx.fibGoldenPocket}</code>
${paConclusion}`
      : '⚠️ 多週期數據不足，PA 暫時唔提供入場參考。';

    const trendDayDisplay = `🎚️ <b>[Tape Regime · 單邊日雷達]</b>
Regime：<code>${trendDayContext.regime}</code> | Bias：<code>${trendDayContext.directionalBias}</code> | Confidence：<code>${trendDayContext.confidence}%</code>
建議：<code>${trendDayContext.recommendedAction}</code> | IC：<code>${trendDayContext.icAllowed ? 'ALLOWED' : 'BLOCKED'}</code>
理由：${tgEscape(trendDayContext.rationale)}${trendDayContext.icBlockReason ? `\nIC Block：${tgEscape(trendDayContext.icBlockReason)}` : ''}`;

    const fmtLevel = (level: IntradayKeyLevel | null) =>
      level ? `<code>${level.level.toFixed(0)}</code> (${level.touches} touches, ${level.distance.toFixed(1)} pts away)` : '<code>N/A</code>';
    const intradayStructureDisplay = `📐 <b>[日內結構 · 目標紀律]</b>
Support：${fmtLevel(intradayStructure.nearestSupport)} | Resistance：${fmtLevel(intradayStructure.nearestResistance)}
紀律：${tgEscape(intradayStructure.targetDisciplineNote)}`;

    // IC summary for display
    const icDisplay = agentIC.ic_action === 'STAND_DOWN'
      ? `🦅 鐵鷹：條件不滿足，按兵不動`
      : `🦅 <b>鐵鷹策略：${agentIC.ic_action}</b>
GEX檢查：${agentIC.gex_check} | VIX檢查：${agentIC.vix_check} | 事件檢查：${agentIC.event_check}
📝 ${tgEscape(agentIC.ic_reasoning || 'N/A')}`;

    const zeroDteList = (items: string[]) => items.length > 0 ? items.slice(0, 5).join(', ') : 'None';
    const zeroDteDisplay = `🧠 <b>[0DTE Rule Engine · Advisory Only]</b>
Verdict：<code>${zeroDteRuleEngine.verdict}</code> | Bias：<code>${zeroDteRuleEngine.directionalBias}</code> | Regime：<code>${zeroDteRuleEngine.marketRegime}</code> | Score：<code>${zeroDteRuleEngine.signalScore}/100</code>
Hard Blocks：<code>${tgEscape(zeroDteList(zeroDteRuleEngine.hardBlocks))}</code>
Active Risks：<code>${tgEscape(zeroDteList(zeroDteRuleEngine.activeRisks))}</code>
Final Advisory：<code>${zeroDteRuleEngine.allowNewSignal ? 'ALLOW_NEW_SIGNAL' : 'CONSERVATIVE_BLOCK_OR_WAIT'}</code>`;

    const message = `SPX: ${context.currentPrice} 操作：${displayAction}
⏱️ <b>美東時間：${etTime} ET</b> | <b>標的：SPX</b>

🏛️ <b>[價格行為 · 機構足跡]</b> (Price Action)
${trendDayDisplay}

${paContextDisplay}

${intradayStructureDisplay}

📊 <b>[期權籌碼 · PCR 指標]</b>
Put/Call Ratio：<code>${context.pcrValue}</code> — ${tgEscape(context.pcrStatus)}

📡 <b>[期權 GEX 訊號]</b>${calculatedGex ? ` (${calculatedGex.generatedAt})` : ' 數據缺失'}
${calculatedGex ? `來源：<code>Internal Yahoo Options GEX Calculator</code>
系統態勢：<b>${calculatedGex.gammaStatus === 'positive_gamma' ? '✅ Positive Gamma — 橡皮筋模式（做市商吸收波動）' : '⚠️ Negative Gamma — 滑滑梯模式（波動放大）'}</b>
🔄 Gamma Flip (ZG)：<code>${calculatedGex.gammaFlipLevel}</code> (${(spxInd.currentClose > (calculatedGex.gammaFlipLevel || 0)) ? '在 Flip 之上↑ 多方有利' : '在 Flip 之下↓ 空方佔優'})
🟢 最強多方 (SG_High)：<code>${calculatedGex.mostLongStrike}</code> (${calculatedGex.mostLongGex}) | 🔴 最強空方 (SG_Low)：<code>${calculatedGex.mostShortStrike}</code> (${calculatedGex.mostShortGex})
📊 Long Walls：${calculatedGex.longWalls?.slice(0, 3).map((w: any) => `${w.strike}(${w.gex})`).join(' ► ') || 'N/A'}
📉 Short Pockets：${calculatedGex.shortPockets?.slice(0, 3).map((p: any) => `${p.strike}(${p.gex})`).join(' ► ') || 'N/A'}` : '⚠️ 數據抓取失敗'}

${zeroDteDisplay}

⚖️ <b>[理事會決議 · 專家辯論]</b> (4方向性 + 1鐵鷹)
🟢 <code>${buyVotes}</code> | 🔴 <code>${sellVotes}</code> | ⚪ <code>${holdVotes}</code> [🔥 核心共識: <b>${consensusVote}</b>]
🗣️ <b>專家深度腦爆</b> (Expert Rapid-Fire)

🦁 <b>QM: ${formatAgentDecision(d1)} (Momentum)</b>:
${tgEscape(agent1.reasoning)}

🌊 <b>CM: ${formatAgentDecision(d2)} (GEX Decision)</b>:
${tgEscape(agent2.reasoning)}

🦢 <b>NT: ${formatAgentDecision(d3)} (Sentiment)</b>:
${tgEscape(agent3.reasoning)}

🏛️ <b>PA: ${formatAgentDecision(d4)} (Price Action)</b>:
${tgEscape(agent4.reasoning)}

${icDisplay}

🛡️ <b>[雷霆一擊 · 終極執行]</b> (Thor Execution Plan)
<b>操作：</b> <code>${tgEscape(finalDisplayAction)}</code>
<b>買點：</b> ${tgEscape((orchestratorPlan as any).buy_zone || "N/A")}
<b>止損：</b> ${tgEscape((orchestratorPlan as any).stop_loss || "N/A")}
<b>止盈：</b> ${tgEscape((orchestratorPlan as any).take_profit || "N/A")}
<b>風控：</b> ${tgEscape((orchestratorPlan as any).risk_warning || "N/A")}

<pre>-- CF Worker v4.0.0 | 5-Agent Council (QM/CM/NT/PA/IC) --</pre>
`;

    console.log('[DEBUG] Step 6: Sending Final Report...');
    const success = await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, message.trim());
    if (!success) {
      console.error('[ERR] Final send failed');
    }

  } catch (e: any) {
    console.error('CRITICAL BOT ERROR:', e.message);
    const errorMsg = `⚠️ <b>[系統預警] 專家分析中斷</b>\n市場數據仍可讀取。\nError: ${tgEscape(e.message)}`;
    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, errorMsg);
  }
}

async function runEndOfDayAudit(env: Env, now: Date = new Date(), options: ScheduledRunOptions = {}) {
  const marketStatus = getMarketScheduleStatus(now);
  if (!options.force && !marketStatus.isMarketOpenDay) {
    console.log(`[SCHEDULE] Skip audit run: ${marketStatus.skipReason || 'market_closed'} ${marketStatus.etDateKey}`);
    return;
  }

  const etNow = marketStatus.etNow;
  const etDateStr = etNow.getFullYear() + "-" + (etNow.getMonth() + 1).toString().padStart(2, '0') + "-" + etNow.getDate().toString().padStart(2, '0');
  const memoryKey = `spx_memory_${etDateStr}`;
  const rawMemory = await env.SPX_MEMORY.get(memoryKey);

  if (!rawMemory) {
    console.log("[AUDIT] No memory found for today.");
    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, `⚠️ <b>[盤後審計]</b> 查無今日 (${etDateStr}) 的交易記憶，無需生成審計報告。`);
    return;
  }
  const memory: DailyMemory = JSON.parse(rawMemory);

  try {
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
        messages: [
          { role: 'system', content: AUDIT_AGENT_PROMPT },
          { role: 'user', content: `Today's Action Log: ${JSON.stringify(memory.actionLog)}` }
        ]
      })
    }, 30000);

    if (!response.ok) throw new Error("Audit generation failed");
    const data = await response.json() as any;
    let report = data.choices[0].message.content;

    // Parse out learned rules for self-evolution
    const jsonMatch = report.match(/```json\s*([\s\S]*?)\s*```/i);
    let extractedRules: string[] = [];
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.learned_rules && Array.isArray(parsed.learned_rules)) {
          extractedRules = parsed.learned_rules;
        }
      } catch (err) {
        console.error('Failed to parse learned_rules JSON:', err);
      }
      // Remove JSON block from report to keep Telegram clean
      report = report.replace(/```json\s*[\s\S]*?\s*```/i, '').trim();
    }

    if (extractedRules.length > 0) {
      const existingBook = await env.SPX_MEMORY.get('SPX_WISDOM_BOOK');
      let wisdomBook: string[] = existingBook ? JSON.parse(existingBook) : [];
      // Prepend new rules and keep only the latest 10
      wisdomBook = [...extractedRules, ...wisdomBook].slice(0, 10);
      await env.SPX_MEMORY.put('SPX_WISDOM_BOOK', JSON.stringify(wisdomBook));
      console.log('[AUDIT] Saved new rules to SPX_WISDOM_BOOK', extractedRules);
    }

    await env.SPX_MEMORY.put(`spx_audit_${etDateStr}`, JSON.stringify({
      date: etDateStr,
      generatedAt: new Date().toISOString(),
      report,
      learnedRules: extractedRules,
      actionLogSize: memory.actionLog.length
    }));
    console.log('[AUDIT] Saved daily recap report to SPX_MEMORY', `spx_audit_${etDateStr}`);
    await persistRecapDayToD1(env, etDateStr, memory, {
      report,
      learnedRules: extractedRules,
      generatedAt: new Date().toISOString()
    });

    const finalMsg = `📅 <b>【每日審計清單】 (${etDateStr})</b>\n\n<pre>${tgEscape(report)}</pre>`;

    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, finalMsg);
  } catch (e: any) {
    console.error('[AUDIT] Failed to generate audit', e);
    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, `❌ <b>[審計失敗]</b> ${tgEscape(e.message || String(e))}`);
  }
}

async function runSpxGexHeatmapGeneration(env: Env, now: Date = new Date(), options: ScheduledRunOptions = {}) {
  if (!env.SPX_RECAP_DB) {
    console.log('[SPX_GEX_HEATMAP] Skip: SPX_RECAP_DB binding is missing.');
    return;
  }

  try {
    const result = await generateAndStoreSpxGexHeatmap({
      db: env.SPX_RECAP_DB,
      dataClient: new NativeSpxGexYahooClient(),
      now,
      force: options.force
    });
    console.log(`[SPX_GEX_HEATMAP] ${result.status} ${result.date}${'reason' in result ? ` ${result.reason}` : ''}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[SPX_GEX_HEATMAP] Generation failed', message);
  }
}

// --- Worker Entry Point ---

export default {
  async scheduled(event: any, env: Env, ctx: any) {
    const scheduledAt = new Date(typeof event.scheduledTime === 'number' ? event.scheduledTime : Date.now());
    const marketStatus = getMarketScheduleStatus(scheduledAt);
    const cron = String(event.cron || '');
    if (!marketStatus.isMarketOpenDay) {
      console.log(`[SCHEDULE] No-op: ${marketStatus.skipReason || 'market_closed'} ${marketStatus.etDateKey}`);
      return;
    }

    if (cron === AUDIT_CRON && marketStatus.isAuditWindow) {
      ctx.waitUntil(runEndOfDayAudit(env, scheduledAt));
      return;
    }

    if (cron === SPX_GEX_HEATMAP_CRON) {
      ctx.waitUntil(runSpxGexHeatmapGeneration(env, scheduledAt));
      return;
    }

    if (cron === TRADING_CRON && marketStatus.isTradingWindow) {
      ctx.waitUntil(runTradingAgents(env, scheduledAt));
      return;
    }

    console.log(`[SCHEDULE] No-op: outside configured ET windows cron=${cron} date=${marketStatus.etDateKey} minutes=${marketStatus.minutes}`);
  },
  async fetch(request: Request, env: Env, ctx: any) {
    const url = new URL(request.url);

    // 🔒 安全防護：驗證請求，防止互聯網掃描器/爬蟲隨機觸發 AI API (浪費您的錢)
    const reqToken = url.searchParams.get('token');

    // 如果沒有在 Cloudflare 設置 WEBHOOK_SECRET，則預設使用 TELEGRAM_CHAT_ID 作為簡單驗證密碼
    const expectedToken = env.WEBHOOK_SECRET || env.TELEGRAM_CHAT_ID;

    if (reqToken !== expectedToken) {
      return new Response('Unauthorized: Please provide a valid ?token parameter to protect your AI credits!', { status: 401 });
    }

    const forceManualRun = url.searchParams.has('force');

    // ?audit — 手動觸發盤後審計報告
    if (url.searchParams.has('audit')) {
      ctx.waitUntil(runEndOfDayAudit(env, new Date(), { force: forceManualRun }));
      return new Response('Audit triggered — check Telegram in ~30s.');
    }

    if (url.searchParams.has('gex')) {
      ctx.waitUntil(runSpxGexHeatmapGeneration(env, new Date(), { force: forceManualRun }));
      return new Response('SPX GEX heatmap generation triggered.');
    }

    if (url.searchParams.has('debug')) {
      const logs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...args) => logs.push(`[LOG] ${args.join(' ')}`);
      console.error = (...args) => logs.push(`[ERR] ${args.join(' ')}`);

      try {
        await runTradingAgents(env, new Date(), { force: forceManualRun });
        return new Response(`DEBUG COMPLETE.\n\nLOGS:\n${logs.join('\n')}`);
      } catch (e: any) {
        return new Response(`DEBUG ERROR: ${e.message}\n${e.stack}\n\nLOGS:\n${logs.join('\n')}`, { status: 500 });
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    }
    ctx.waitUntil(runTradingAgents(env, new Date(), { force: forceManualRun }));
    return new Response('Analysis triggered.');
  }
};
