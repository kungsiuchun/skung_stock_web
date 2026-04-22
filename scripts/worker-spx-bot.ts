import { RSI, BollingerBands, SMA, MACD, EMA } from 'technicalindicators';
import { PERSONAS, ORCHESTRATOR_PROMPT, SYSTEM_PROMPT_PREFIX } from './prompts';

// Cloudflare Worker Environment Types
interface Env {
  TELEGRAM_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

    console.log('[DEBUG] Step 1: Fetching Yahoo Quotes & Options...');
    const spxQuotes = await fetchYahooChart('^GSPC', '15m', '7d');
    const vixQuotes = await fetchYahooChart('^VIX', '15m', '7d');
    const pcrValue = await fetchYahooOptionsPCR('^SPX');

    console.log('[DEBUG] Step 2: Calculating Indicators...');
    const spxInd = await calculateIndicators(spxQuotes);
    const currentVix = vixQuotes[vixQuotes.length - 1]?.close;

    if (!spxInd) {
      throw new Error('無法計算技術指標');
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
    const extendedContext = { ...context, macd: spxInd.macd, fundFlow };

    console.log('[DEBUG] Step 3: Triggering AI Agents (Gemma Free)...');
    const [agent1, agent2, agent3] = await Promise.all([
      analyzeWithAgent('Goldman', PERSONAS.GOLDMAN_WARRIOR, extendedContext, env),
      analyzeWithAgent('Citadel', PERSONAS.CITADEL_QUANT, extendedContext, env),
      analyzeWithAgent('OptionsFlow', PERSONAS.REVERSION_OPTIONS_SPECIALIST, extendedContext, env)
    ]);

    const buyVotes = [agent1.decision, agent2.decision, agent3.decision].filter(d => d === 'BUY').length;
    const sellVotes = [agent1.decision, agent2.decision, agent3.decision].filter(d => d === 'SELL').length;
    const holdVotes = [agent1.decision, agent2.decision, agent3.decision].filter(d => d === 'HOLD').length;
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

    const etTime = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date());

    const toM = (val: number) => (val / 1000000).toFixed(1) + 'M';
    const message = `
⏱️ <b>美東時間：${etTime} ET</b> | <b>標的：SPX</b>

⚡ <b>[市場雷達 · 實時全景]</b>
今日 SPX 現報 <code>${context.currentPrice}</code> | VIX <code>${context.currentVix}</code>
技術面：RSI <code>${context.rsi14}</code> | Bollinger <code>${context.bollingerBandwidth}</code>
📦 通道狀態：${context.isSqueeze ? '⚠️ 處於劇烈擠壓，能量正在蓄積' : '通道正常擴張，趨勢慣性延續'}

💸 <b>[主力資金 · 潮汐觀察]</b> (Fund Flow)
6H 累計淨流入：<code>$${((fundFlow?.mainNetInflow || 0) / 1000000).toFixed(2)}M</code>
解讀：${tgEscape(fundFlow?.interpretation || '數據缺失')}

📊 <b>[期權籌碼與回歸動態]</b>
Put/Call Ratio：<code>${context.pcrValue}</code>
EMA9 短均線：<code>${context.ema9}</code> (${context.ema9Trend})
VWAP 乖離：價格偏離今日 VWAP 達 <code>${context.vwapDeviation}</code>
狀態解讀：${tgEscape(context.pcrStatus)}

⚖️ <b>[理事會決議 · 專家辯論]</b>
🟢 <code>${buyVotes}</code> | 🔴 <code>${sellVotes}</code> | ⚪ <code>${holdVotes}</code> [🔥 核心共識: <b>${consensusVote}</b>]
🗣️ <b>專家銳評</b> (Expert Rapid-Fire)

🦁 <b>Shark</b>:
${tgEscape(agent1.reasoning)}

🦅 <b>Quant</b>:
${tgEscape(agent2.reasoning)}

🦢 <b>Grizzly</b>:
${tgEscape(agent3.reasoning)}

🛡️ <b>[雷霆執行計劃 · 風控方案]</b>
<b>策略：</b> ${tgEscape(orchestratorPlan.strategy)}
<b>邏輯：</b> ${tgEscape(orchestratorPlan.logic)}
<b>風控：</b> <code>${tgEscape(orchestratorPlan.risk_management)}</code>

<pre>-- CF Worker v2.2.2 | Production Stable --</pre>
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

// --- Worker Entry Point ---

export default {
  async scheduled(event: any, env: Env, ctx: any) {
    ctx.waitUntil(runTradingAgents(env));
  },
  async fetch(request: Request, env: Env, ctx: any) {
    const url = new URL(request.url);
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
