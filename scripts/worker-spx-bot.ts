import { RSI, BollingerBands, SMA, MACD, EMA } from 'technicalindicators';
import { PERSONAS, ORCHESTRATOR_PROMPT, SYSTEM_PROMPT_PREFIX, AUDIT_AGENT_PROMPT, ALPHA_EAR_SENTIMENT_PROMPT } from './prompts';

// Cloudflare Worker Environment Types
interface Env {
  TELEGRAM_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  WEBHOOK_SECRET?: string; // 🔒 防護互聯網隨機觸發的安全金鑰
  SPX_MEMORY: any;
}

interface ActionLogItem {
  time: string;
  price: number;
  action: string;
  reasoning: string;
  pnl?: number;
}
interface DailyMemory {
  currentPosition: "NONE" | "CALL" | "PUT";
  entryPrice: number | null;
  entryTime: string | null;
  actionLog: ActionLogItem[];
}
interface TgGexData {
  spot?: number;
  gammaFlipLevel?: number;
  gammaStatus?: string;
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
    const res = await fetchWithTimeout('https://newsnow.busiyi.world/api/s?id=wallstreetcn', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, 10000);
    if (!res.ok) return { score: 0, label: 'neutral', reason: 'News API error' };
    const data = await res.json() as any;
    const items = data.items?.slice(0, 10).map((i: any) => i.title).join('\n') || '';

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
    currentVWAP,
    vwapDeviation
  };
}

async function getFundFlow(quotes: any[]) {
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

  return {
    mainNetInflow: totalNet,
    superLarge,
    large,
    medium,
    small,
    interpretation: totalNet > 0 ? "主力資金強勢掃貨，機構護盤盤感明顯" : "主力資金高位套現，散戶接盤壓力劇增"
  };
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

async function runTradingAgents(env: Env) {
  try {
    // 0. 密鑰效驗 (PUA 診斷)
    if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) {
      throw new Error(`環境變量缺失: TOKEN=${!!env.TELEGRAM_TOKEN}, CHAT=${!!env.TELEGRAM_CHAT_ID}`);
    }

    console.log('[DEBUG] 💓 任務啟動：發送心跳...');
    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, "💓 <b>系統心跳：診斷任務已啟動...</b>\n正在獲取市場數據中...");

    // Memory Fetch
    const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const etDateStr = etNow.getFullYear() + "-" + (etNow.getMonth() + 1).toString().padStart(2, '0') + "-" + etNow.getDate().toString().padStart(2, '0');
    const memoryKey = `spx_memory_${etDateStr}`;

    const etTime = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date());

    // 並行讀取日內記憶 + Telegram GEX 快照
    const [rawMemory, rawTgGex] = await Promise.all([
      env.SPX_MEMORY.get(memoryKey),
      env.SPX_MEMORY.get('tg_gex_latest')
    ]);
    let dailyMemory: DailyMemory = rawMemory ? JSON.parse(rawMemory) : { currentPosition: "NONE", entryPrice: null, entryTime: null, actionLog: [] };
    const tgGex: TgGexData | null = rawTgGex ? JSON.parse(rawTgGex) : null;
    const tgGexAge = tgGex?.parsedAt ? Math.round((Date.now() - new Date(tgGex.parsedAt).getTime()) / 60000) : null;

    console.log('[DEBUG] Step 1: Fetching Yahoo Quotes, Options & News...');
    const [spxQuotes, spxQuotesM5, vixQuotes, pcrValue, sentimentData] = await Promise.all([
      fetchYahooChart('^GSPC', '15m', '7d'),
      fetchYahooChart('^GSPC', '5m', '2d'),
      fetchYahooChart('^VIX', '15m', '7d'),
      fetchYahooOptionsPCR('^SPX'),
      fetchNewsAndSentiment(env)
    ]);

    console.log('[DEBUG] Step 2: Calculating Indicators...');
    const spxInd = await calculateIndicators(spxQuotes);
    const currentVix = vixQuotes[vixQuotes.length - 1]?.close;

    if (!spxInd) {
      throw new Error('無法計算技術指標');
    }

    const m5Quotes = spxQuotesM5.filter((q: any) => q.close !== null);
    let m5Analysis = { boxHigh: 0, boxLow: 0, volumeSurge: 1, currentM5Vol: 0, avgM5Vol: 0 };
    if (m5Quotes.length >= 24) {
      const last24 = m5Quotes.slice(-24); // 2 hours
      m5Analysis.boxHigh = Math.max(...last24.map((q: any) => q.high));
      m5Analysis.boxLow = Math.min(...last24.map((q: any) => q.low));
    }
    if (m5Quotes.length >= 11) {
      const last10 = m5Quotes.slice(-11, -1);
      m5Analysis.avgM5Vol = last10.reduce((sum: number, q: any) => sum + (q.volume || 0), 0) / 10;
      m5Analysis.currentM5Vol = m5Quotes[m5Quotes.length - 1].volume || 0;
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
      ema9Trend: spxInd.currentClose > (spxInd.ema9 || 0) ? 'Bullish (Above EMA9)' : 'Bearish (Below EMA9)',
      currentVWAP: spxInd.currentVWAP.toFixed(2),
      vwapDeviation: spxInd.vwapDeviation.toFixed(2) + '%',
      pcrValue: pcrValue ? pcrValue.toFixed(2) : 'N/A',
      pcrStatus: pcrStatus
    };

    const fundFlow = await getFundFlow(spxQuotes);

    // Skavinski TG GEX 整合到 AI context
    const tgGexContext = tgGex ? {
      source: `Skavinski GEX (${tgGex.generatedAt || 'unknown'}, ${tgGexAge != null ? `${tgGexAge}min ago` : 'unknown age'})`,
      gammaFlipLevel: tgGex.gammaFlipLevel,
      gammaStatus: tgGex.gammaStatus,
      mostLongGammaStrike: `${tgGex.mostLongStrike} (${tgGex.mostLongGex})`,
      mostShortGammaStrike: `${tgGex.mostShortStrike} (${tgGex.mostShortGex})`,
      longGammaWalls: tgGex.longWalls?.map(w => `${w.strike}(${w.gex})`).join(' > '),
      shortGammaPockets: tgGex.shortPockets?.map(p => `${p.strike}(${p.gex})`).join(' > '),
      netFlowTarget: `Upper:${tgGex.netFlowUpper?.strike} Lower:${tgGex.netFlowLower?.strike}`,
      putCallIvSkew: tgGex.putCallIvSkew ? `${tgGex.putCallIvSkew}% (puts more expensive)` : null
    } : null;

    const extendedContext = {
      currentTime: etTime,
      ...context,
      macd: spxInd.macd,
      fundFlow,
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
      skavinskiGEX: tgGexContext,
      TODAYS_MEMORY: {
        currentPosition: dailyMemory.currentPosition,
        entryPrice: dailyMemory.entryPrice,
        recentActions: dailyMemory.actionLog.slice(-3)
      }
    };

    console.log('[DEBUG] Step 3: Triggering AI Agents (Gemma Free)...');
    const [agent1, agent2, agent3] = await Promise.all([
      analyzeWithAgent('QM', PERSONAS.QM_MOMENTUM_SNIPER, extendedContext, env),
      analyzeWithAgent('CM', PERSONAS.CM_OPTIONS_MAKER, extendedContext, env),
      analyzeWithAgent('NT', PERSONAS.NT_MACRO_SENTIMENT, extendedContext, env)
    ]);

    const normalizeDecision = (d: string) => d ? d.toString().trim().toUpperCase() : "HOLD";
    const d1 = normalizeDecision(agent1.decision);
    const d2 = normalizeDecision(agent2.decision);
    const d3 = normalizeDecision(agent3.decision);

    const buyVotes = [d1, d2, d3].filter(d => d === 'BUY' || d === 'LONG').length;
    const sellVotes = [d1, d2, d3].filter(d => d === 'SELL' || d === 'SHORT' || d === 'PUT').length;
    const holdVotes = 3 - buyVotes - sellVotes;
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
            { role: 'user', content: `Market Context: ${JSON.stringify(extendedContext)}\nAgent 1: ${JSON.stringify(agent1)}\nAgent 2: ${JSON.stringify(agent2)}\nAgent 3: ${JSON.stringify(agent3)}` }
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

    // Update Memory based on Action
    const tradeAction = (orchestratorPlan as any).trade_action || "HOLD";
    const currentPriceStr = spxInd.currentClose;

    if (tradeAction === 'OPEN_CALL' && dailyMemory.currentPosition === 'NONE') {
      dailyMemory.currentPosition = 'CALL';
      dailyMemory.entryPrice = currentPriceStr;
      dailyMemory.entryTime = etTime;
      dailyMemory.actionLog.push({ time: etTime, price: currentPriceStr, action: '買入 Call', reasoning: orchestratorPlan.logic });
    } else if (tradeAction === 'OPEN_PUT' && dailyMemory.currentPosition === 'NONE') {
      dailyMemory.currentPosition = 'PUT';
      dailyMemory.entryPrice = currentPriceStr;
      dailyMemory.entryTime = etTime;
      dailyMemory.actionLog.push({ time: etTime, price: currentPriceStr, action: '買入 Put', reasoning: orchestratorPlan.logic });
    } else if (tradeAction === 'CLOSE' && dailyMemory.currentPosition !== 'NONE') {
      const pnlRaw = dailyMemory.currentPosition === 'CALL'
        ? (currentPriceStr - dailyMemory.entryPrice!)
        : (dailyMemory.entryPrice! - currentPriceStr);
      dailyMemory.actionLog.push({
        time: etTime,
        price: currentPriceStr,
        action: `平倉 ${dailyMemory.currentPosition}`,
        reasoning: orchestratorPlan.logic,
        pnl: parseFloat(pnlRaw.toFixed(2))
      });
      dailyMemory.currentPosition = 'NONE';
      dailyMemory.entryPrice = null;
      dailyMemory.entryTime = null;
    } else if (tradeAction === 'HOLD' && dailyMemory.currentPosition === 'NONE') {
      dailyMemory.actionLog.push({ time: etTime, price: currentPriceStr, action: '觀望防守', reasoning: orchestratorPlan.logic });
    }

    // Save Memory
    const etNowDateStr = etTime.split(' ')[0].replace(/\//g, '-');
    const dbKey = `spx_memory_${etNowDateStr}`;
    await env.SPX_MEMORY.put(dbKey, JSON.stringify(dailyMemory));

    const toM = (val: number) => (val / 1000000).toFixed(1) + 'M';
    const message = `
⏱️ <b>美東時間：${etTime} ET</b> | <b>標的：SPX</b>

⚡ <b>[市場雷達 · 實時全景]</b>
今日 SPX 現報 <code>${context.currentPrice}</code> | VIX <code>${context.currentVix}</code>
M5 級別：2H Box <code>[${m5Analysis.boxLow.toFixed(2)} - ${m5Analysis.boxHigh.toFixed(2)}]</code> | 量能 <code>${m5Analysis.volumeSurge.toFixed(2)}x</code>
新聞情緒：<code>${sentimentData.score}</code> (${sentimentData.label}) - ${tgEscape(sentimentData.reason)}
技術面：RSI <code>${context.rsi14}</code> | Bollinger <code>${context.bollingerBandwidth}</code>
📦 通道狀態：${context.isSqueeze ? '⚠️ 處於劇烈擠壓，能量正在蓄積' : '通道正常擴張，趨勢慣性延續'}

💸 <b>[主力資金 · 潮汐觀察]</b> (Fund Flow)
6H 累計淨流入：<code>$${((fundFlow?.mainNetInflow || 0) / 1000000).toFixed(2)}M</code>
解讀：${tgEscape(fundFlow?.interpretation || '數據缺失')}

📊 <b>[期權籌碼 · PCR 指標]</b>
Put/Call Ratio：<code>${context.pcrValue}</code> — ${tgEscape(context.pcrStatus)}
EMA9：<code>${context.ema9}</code> (${context.ema9Trend}) | VWAP 乖離：<code>${context.vwapDeviation}</code>

📡 <b>[Skavinski GEX 信號]</b>${tgGex ? ` (${tgGex.generatedAt}${tgGexAge != null ? `, ${tgGexAge}min ago` : ''})` : ' 數據缺失'}
${tgGex ? `系統態勢：<b>${tgGex.gammaStatus === 'positive_gamma' ? '✅ Positive Gamma — 做市商吸收波動' : '⚠️ Negative Gamma — 波動放大模式'}</b>
🔄 Gamma Flip：<code>${tgGex.gammaFlipLevel}</code> (${(spxInd.currentClose > (tgGex.gammaFlipLevel || 0)) ? '在 Flip 之上↑ 多方有利' : '在 Flip 之下↓ 空方佔優'})
🟢 最強多方：<code>${tgGex.mostLongStrike}</code> (${tgGex.mostLongGex}) | 🔴 最強空方：<code>${tgGex.mostShortStrike}</code> (${tgGex.mostShortGex})
📊 Long Walls：${tgGex.longWalls?.slice(0, 3).map(w => `${w.strike}(${w.gex})`).join(' ► ') || 'N/A'}
📊 Short Pockets：${tgGex.shortPockets?.slice(0, 3).map(p => `${p.strike}(${p.gex})`).join(' ► ') || 'N/A'}
↕️ 流動目標：Upper <code>${tgGex.netFlowUpper?.strike}</code> ∣ Lower <code>${tgGex.netFlowLower?.strike}</code>
IV Skew： Puts 比 Calls 貴 <code>${tgGex.putCallIvSkew}%</code>` : '⚠️ 執行 <code>node scripts/tg-gex-scraper.cjs</code> 更新數據'}  

⚖️ <b>[理事會決議 · 專家辯論]</b>
🟢 <code>${buyVotes}</code> | 🔴 <code>${sellVotes}</code> | ⚪ <code>${holdVotes}</code> [🔥 核心共識: <b>${consensusVote}</b>]
🗣️ <b>專家深度腦爆</b> (Expert Rapid-Fire)

🦁 <b>QM (Momentum)</b>:
${tgEscape(agent1.reasoning)}

🌊 <b>CM (Options)</b>:
${tgEscape(agent2.reasoning)}

🦢 <b>NT (Sentiment)</b>:
${tgEscape(agent3.reasoning)}

🛡️ <b>[雷霆一擊 · 終極執行]</b> (Thor Execution Plan)
<b>操作：</b> <code>${tgEscape((orchestratorPlan as any).trade_action || "HOLD")}</code>
<b>買點：</b> ${tgEscape((orchestratorPlan as any).buy_zone || "N/A")}
<b>止損：</b> ${tgEscape((orchestratorPlan as any).stop_loss || "N/A")}
<b>止盈：</b> ${tgEscape((orchestratorPlan as any).take_profit || "N/A")}
<b>風控：</b> ${tgEscape((orchestratorPlan as any).risk_warning || "N/A")}

<pre>-- CF Worker v3.0.0 | M5/Sentiment Engine --</pre>
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

async function runEndOfDayAudit(env: Env) {
  const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const etDateStr = etNow.getFullYear() + "-" + (etNow.getMonth() + 1).toString().padStart(2, '0') + "-" + etNow.getDate().toString().padStart(2, '0');
  const memoryKey = `spx_memory_${etDateStr}`;
  const rawMemory = await env.SPX_MEMORY.get(memoryKey);

  if (!rawMemory) {
    console.log("[AUDIT] No memory found for today.");
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
    const report = data.choices[0].message.content;
    const finalMsg = `📅 <b>【每日審計清單】 (${etDateStr})</b>\n\n<pre>${tgEscape(report)}</pre>`;

    await sendTelegramMessage(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID, finalMsg);
  } catch (e: any) {
    console.error('[AUDIT] Failed to generate audit', e);
  }
}

// --- Worker Entry Point ---

export default {
  async scheduled(event: any, env: Env, ctx: any) {
    // audit cron 必須與 wrangler.spx.toml 的 crons 陣列完全一致
    // 15 20 * * 1-5 -> UTC 20:15 (EDT 16:15，即美東時間下午 4:15 收盤後 15 分鐘)
    if (event.cron === "15 20 * * 1-5") {
      ctx.waitUntil(runEndOfDayAudit(env));
    } else {
      ctx.waitUntil(runTradingAgents(env));
    }
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

    // ?audit — 手動觸發盤後審計報告
    if (url.searchParams.has('audit')) {
      ctx.waitUntil(runEndOfDayAudit(env));
      return new Response('Audit triggered — check Telegram in ~30s.');
    }

    if (url.searchParams.has('debug')) {
      const logs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...args) => logs.push(`[LOG] ${args.join(' ')}`);
      console.error = (...args) => logs.push(`[ERR] ${args.join(' ')}`);

      try {
        await runTradingAgents(env);
        return new Response(`DEBUG COMPLETE.\n\nLOGS:\n${logs.join('\n')}`);
      } catch (e: any) {
        return new Response(`DEBUG ERROR: ${e.message}\n${e.stack}\n\nLOGS:\n${logs.join('\n')}`, { status: 500 });
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    }
    ctx.waitUntil(runTradingAgents(env));
    return new Response('Analysis triggered.');
  }
};
