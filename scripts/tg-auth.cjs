/**
 * tg-auth.cjs
 * 一次性登入腳本 — 執行後儲存 SESSION_STRING 到 .dev.vars
 * 用法: node scripts/tg-auth.cjs
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');

// ── 讀取 .dev.vars ──────────────────────────────────────
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

function writeVar(key, value) {
  let content = fs.readFileSync(VARS_PATH, 'utf-8');
  const escapedValue = value.includes('\n') ? `"${value}"` : value;
  if (content.includes(`${key}=`)) {
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${escapedValue}`);
  } else {
    content += `\n${key}=${escapedValue}`;
  }
  fs.writeFileSync(VARS_PATH, content.trim() + '\n');
  console.log(`✅ ${key} 已儲存到 .dev.vars`);
}

// ── Main ────────────────────────────────────────────────
(async () => {
  const vars = readVars();

  const API_ID = parseInt(vars.TG_API_ID || '0');
  const API_HASH = vars.TG_API_HASH || '';

  if (!API_ID || !API_HASH) {
    console.error('❌ 缺少 TG_API_ID 或 TG_API_HASH，請先加到 .dev.vars');
    console.log('   去 https://my.telegram.org 申請');
    process.exit(1);
  }

  const existingSession = vars.TG_SESSION_STRING || '';
  const session = new StringSession(existingSession);

  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  console.log('🔑 連接 Telegram MTProto...');
  await client.start({
    phoneNumber: async () => await input.text('📱 輸入你的電話號碼 (+852XXXXXXXX): '),
    password: async () => await input.text('🔒 兩步驗證密碼 (如有，否則按 Enter): '),
    phoneCode: async () => await input.text('📨 輸入 Telegram 發送的驗證碼: '),
    onError: (err) => console.error('登入錯誤:', err),
  });

  const sessionString = client.session.save();
  writeVar('TG_SESSION_STRING', sessionString);

  const me = await client.getMe();
  console.log(`\n✅ 登入成功！用戶: @${me.username || me.firstName}`);
  console.log('🎯 Session 已儲存，之後使用 tg-gex-scraper.cjs 唔需要再登入');

  await client.disconnect();
  process.exit(0);
})();
