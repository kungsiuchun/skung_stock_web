/**
 * tg-gex-scraper.cjs
 * å®šæœŸå¾ž @skavinskitrading SPX GEX/Flow topic æŠ“å– GEX æ•¸æ“š
 * ä¸¦å¯«å…¥ Cloudflare KV (tg_gex_latest)
 *
 * è¨­ç½®: æ¯ 5 åˆ†é˜åŸ·è¡Œä¸€æ¬¡ (via Windows Task Scheduler æˆ–æ‰‹å‹•)
 * ç”¨æ³•: node scripts/tg-gex-scraper.cjs
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const https = require('https');
const fs = require('fs');
const path = require('path');

// â”€â”€ è®€å– .dev.vars â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const VARS_PATH = path.resolve(__dirname, '../.dev.vars');

function readVars() {
  const content = fs.readFileSync(VARS_PATH, 'utf-8');
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    vars[key.trim()] = rest.join('=').trim().replace(/^"|"$/g, '');
  }
  return vars;
}

// â”€â”€ Parse GEX Message Text â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseGexMessage(text) {
  if (!text || !text.includes('SPX GEX')) return null;

  // æ­£è¦åŒ– Unicode è² è™Ÿ (âˆ’, â€’, â€“) æˆ ASCII hyphen
  const t = text
    .replace(/\u2212/g, '-')   // âˆ’ (minus)
    .replace(/\u2013/g, '-')   // â€“ (en-dash)
    .replace(/\u2014/g, '-');  // â€” (em-dash)

  const result = {
    raw: text,
    parsedAt: new Date().toISOString(),
    source: 'telegram/@skavinskitrading',
  };

  // Spot Price
  const spotMatch = t.match(/Spot[:\s]+([0-9,]+\.?[0-9]*)/i);
  if (spotMatch) result.spot = parseFloat(spotMatch[1].replace(',', ''));


  // Most LONG Î³ (æ ¼å¼: "7150 (+24.9M)" æˆ– "7150 (âˆ’24.9M)")
  const longMatch = t.match(/Most LONG[^0-9\n]*\n([0-9]+)\s*\(([^)]+)\)/i);
  if (longMatch) {
    result.mostLongStrike = parseInt(longMatch[1]);
    result.mostLongGex = longMatch[2];
  }

  // Most SHORT Î³
  const shortMatch = t.match(/Most SHORT[^0-9\n]*\n([0-9]+)\s*\(([^)]+)\)/i);
  if (shortMatch) {
    result.mostShortStrike = parseInt(shortMatch[1]);
    result.mostShortGex = shortMatch[2];
  }

  // HVL 0DTE (Gamma Flip) â€” æ ¼å¼: "âš¡ï¸ HVL 0DTE (Gamma Flip)\nâ‰ˆ7116 â€¢ Status: positive_gamma"
  const hvlMatch = t.match(/HVL[\s\S]*?\n[\u2248~]?([0-9]+)\s*[\u2022\u00b7\|]\s*Status:\s*(\w+)/i);
  if (hvlMatch) {
    result.gammaFlipLevel = parseInt(hvlMatch[1]);
    result.gammaStatus = hvlMatch[2];
  }

  // Top LONG walls — format: "Top LONG ... walls\n7150 (+87.8M) ► 7160..."
  // 唔依賴 γ 字符（可能被 Windows 破壞），直接搵 "Top LONG" 後換行的那一行
  const longWallsMatch = t.match(/Top LONG[^\n]+\n([^\n]+)/i);
  if (longWallsMatch) {
    result.longWalls = [...longWallsMatch[1].matchAll(/([0-9]+)\s*\(([^)]+)\)/g)]
      .map(m => ({ strike: parseInt(m[1]), gex: m[2] }));
  }

  // Top SHORT pockets — same fix
  const shortPocketsMatch = t.match(/Top SHORT[^\n]+\n([^\n]+)/i);
  if (shortPocketsMatch) {
    result.shortPockets = [...shortPocketsMatch[1].matchAll(/([0-9]+)\s*\(([^)]+)\)/g)]
      .map(m => ({ strike: parseInt(m[1]), gex: m[2] }));
  }

  // Net Flow Targets
  const upperMatch = t.match(/Upper:\s*([0-9]+)\s*\(([^)]+)\)/i);
  const lowerMatch = t.match(/Lower:\s*([0-9]+)\s*\(([^)]+)\)/i);
  const floorMatch = t.match(/Floor:\s*([0-9]+)\s*\(([^)]+)\)/i);
  if (upperMatch) result.netFlowUpper = { strike: parseInt(upperMatch[1]), gex: upperMatch[2] };
  if (lowerMatch) result.netFlowLower = { strike: parseInt(lowerMatch[1]), gex: lowerMatch[2] };
  if (floorMatch) result.netFlowFloor = { strike: parseInt(floorMatch[1]), gex: floorMatch[2] };

  // Â±EM Pricing Skew
  const skewMatch = t.match(/Puts are ([0-9.]+)%\s*higher IV/i);
  if (skewMatch) result.putCallIvSkew = parseFloat(skewMatch[1]);

  // Generated time
  const genMatch = t.match(/Generated:\s*([0-9:]+\s*ET)/i);
  if (genMatch) result.generatedAt = genMatch[1];

  return result;
}

// â”€â”€ Write to Cloudflare KV via REST API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function writeToKV(accountId, namespaceId, apiToken, key, value) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(value);
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (parsed.success) resolve(parsed);
        else reject(new Error(`KV write failed: ${JSON.stringify(parsed.errors)}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(async () => {
  const vars = readVars();

  const API_ID = parseInt(vars.TG_API_ID || '0');
  const API_HASH = vars.TG_API_HASH || '';
  const SESSION_STRING = vars.TG_SESSION_STRING || '';
  const CF_ACCOUNT_ID = vars.CF_ACCOUNT_ID || '';
  const CF_API_TOKEN = vars.CF_API_TOKEN || '';
  const KV_NAMESPACE_ID = vars.KV_NAMESPACE_ID || 'd885526d2249419eaf921dcb7dd27488'; // SPX_MEMORY

  // é©—è­‰å¿…è¦ credentials
  const missing = [];
  if (!API_ID) missing.push('TG_API_ID');
  if (!API_HASH) missing.push('TG_API_HASH');
  if (!SESSION_STRING) missing.push('TG_SESSION_STRING (å…ˆè·‘ tg-auth.cjs)');
  if (!CF_ACCOUNT_ID) missing.push('CF_ACCOUNT_ID');
  if (!CF_API_TOKEN) missing.push('CF_API_TOKEN');

  if (missing.length > 0) {
    console.error('âŒ ç¼ºå°‘ä»¥ä¸‹ .dev.vars è¨­ç½®:');
    missing.forEach(m => console.error(`   - ${m}`));
    process.exit(1);
  }

  console.log(`[${new Date().toISOString()}] ðŸ“¡ é€£æŽ¥ Telegram...`);
  const client = new TelegramClient(
    new StringSession(SESSION_STRING),
    API_ID,
    API_HASH,
    { connectionRetries: 3 }
  );

  await client.connect();

  // è§£æž channel username
  const CHANNEL = 'skavinskitrading';
  const TOPIC_TITLE = 'SPX GEX/Flow';

  try {
    const entity = await client.getEntity(CHANNEL);
    console.log(`âœ… æ‰¾åˆ° channel: ${entity.title || CHANNEL} (id: ${entity.id})`);

    // ç²å–æœ€æ–° 50 æ¢æ¶ˆæ¯ï¼Œæ‰¾ SPX GEX ç›¸é—œçš„
    const messages = await client.getMessages(entity, { limit: 50 });

    let latestGexMessage = null;
    for (const msg of messages) {
      if (!msg.message) continue;
      const parsed = parseGexMessage(msg.message);
      if (parsed && parsed.spot) {
        latestGexMessage = parsed;
        latestGexMessage.telegramMsgId = msg.id;
        latestGexMessage.telegramDate = new Date(msg.date * 1000).toISOString();
        break; // å–æœ€æ–°ä¸€æ¢
      }
    }

    if (!latestGexMessage) {
      console.warn('âš ï¸ æœªæ‰¾åˆ°æœ‰æ•ˆ GEX æ¶ˆæ¯ï¼Œchannel å¯èƒ½å°šæœªæ›´æ–°');
      await client.disconnect();
      process.exit(0);
    }

    console.log(`ðŸ“Š æœ€æ–° GEX æ•¸æ“š (Generated: ${latestGexMessage.generatedAt}):`);
    console.log(`   Spot: ${latestGexMessage.spot}`);
    console.log(`   Gamma Status: ${latestGexMessage.gammaStatus}`);
    console.log(`   Gamma Flip: ${latestGexMessage.gammaFlipLevel}`);
    console.log(`   Most LONG Î³: Strike ${latestGexMessage.mostLongStrike} (${latestGexMessage.mostLongGex})`);
    console.log(`   Most SHORT Î³: Strike ${latestGexMessage.mostShortStrike} (${latestGexMessage.mostShortGex})`);

    // å¯«å…¥ Cloudflare KV
    console.log('\nðŸ“¤ å¯«å…¥ Cloudflare KV...');
    await writeToKV(CF_ACCOUNT_ID, KV_NAMESPACE_ID, CF_API_TOKEN, 'tg_gex_latest', latestGexMessage);
    console.log('âœ… tg_gex_latest å·²æ›´æ–°!\n');

  } catch (e) {
    console.error('âŒ éŒ¯èª¤:', e.message);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
})();



