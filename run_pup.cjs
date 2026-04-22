const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'uat_screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('❌ ERR:', msg.text().substring(0, 150));
  });

  // ── Step 1: Load homepage ──
  console.log('━━━ Step 1: Load Homepage ━━━');
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await wait(3000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '1_homepage.png') });
  console.log('✅ Homepage loaded');

  // ── Step 2: Click AI VISION in nav ──
  console.log('\n━━━ Step 2: Click AI VISION ━━━');
  const aiVisionClicked = await page.evaluate(() => {
    // Find the nav link by text
    const all = [...document.querySelectorAll('a, button, nav a, [class*="nav"] *')];
    const el = all.find(e => e.textContent?.trim().toUpperCase().includes('AI VISION'));
    if (el) { el.click(); return 'clicked: ' + el.tagName + ' - ' + el.textContent.trim(); }
    return null;
  });
  console.log('AI VISION:', aiVisionClicked || '❌ Not found');
  await wait(3000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '2_ai_vision_page.png') });

  // ── Step 3: Click Finance Analyzer card ──
  console.log('\n━━━ Step 3: Click Finance Analyzer Card ━━━');
  const financeClicked = await page.evaluate(() => {
    // Try multiple selectors to find Finance Analyzer
    const selectors = [
      'h3', 'h2', 'h4', 
      '[class*="card"] *', 
      '[class*="Card"] *',
      'button',
      'div[class*="cursor"]',
      'div[onclick]',
      'a'
    ];
    for (const sel of selectors) {
      const els = [...document.querySelectorAll(sel)];
      const el = els.find(e => {
        const txt = e.textContent?.trim();
        return txt?.includes('Finance Analyzer') || txt === 'Finance';
      });
      if (el) {
        // Walk up to find clickable parent
        let target = el;
        for (let i = 0; i < 5; i++) {
          target.click();
          break;
        }
        return 'clicked: ' + el.tagName + ' > ' + el.textContent.trim().substring(0, 50);
      }
    }
    // Log all visible text as debug
    return 'NOT FOUND. Body text: ' + document.body.textContent.substring(0, 300);
  });
  console.log('Finance card:', financeClicked);
  await wait(3000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '3_after_finance_click.png') });

  // Check if we're now on the finance dashboard
  const viewState = await page.evaluate(() => {
    const t = document.body.textContent;
    return {
      hasSearch: !!document.querySelector('input'),
      hasAnalyzeBtn: t.includes('開始分析'),
      hasFinanceAnalyzer: t.includes('Finance Analyzer'),
      snippet: t.substring(0, 200)
    };
  });
  console.log('View state:', JSON.stringify(viewState, null, 2));

  if (!viewState.hasSearch) {
    console.log('\n⚠️ Could not navigate to Finance Dashboard view via UI clicks.');
    console.log('📸 Saving current page DOM for debug...');
    const dom = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
    fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'debug_dom.txt'), dom);
    await browser.close();
    return;
  }

  // ── Step 4: Search AAPL ──
  console.log('\n━━━ Step 4: Search AAPL & Analyze ━━━');
  const input = await page.$('input');
  if (input) {
    await input.click({ clickCount: 3 });
    await input.type('AAPL');
    console.log('✅ Typed AAPL');
  }

  // Click analyze button
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b =>
      b.textContent?.includes('開始分析') || b.textContent?.includes('Analyze')
    );
    if (btn) btn.click();
  });
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '4_analyzing.png') });
  console.log('✅ Analysis started. Waiting up to 80s...');

  // Poll until "分析中" disappears
  for (let i = 0; i < 16; i++) {
    await wait(5000);
    const done = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b =>
        b.textContent?.includes('開始分析') || b.textContent?.trim() === '分析中...'
      );
      // done if button says 開始分析 (not 分析中)
      return !btn?.textContent?.includes('分析中');
    });
    process.stdout.write(`${(i+1)*5}s `);
    if (done && i > 4) { console.log('\n✅ Done!'); break; }
  }
  console.log('');

  // ── Step 5: Capture screenshots ──
  console.log('\n━━━ Step 5: Capture Screenshots ━━━');

  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(1500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '5_top.png') });
  console.log('📸 Top (Header + K-line)');

  await page.evaluate(() => window.scrollTo(0, 600));
  await wait(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '6_mid_chart.png') });
  console.log('📸 Mid (Chart area)');

  await page.evaluate(() => window.scrollTo(0, 1200));
  await wait(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '7_bottom.png') });
  console.log('📸 Bottom (Strategy + FundFlow + FearIndex)');

  // Full page
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '8_full.png'), fullPage: true });
  console.log('📸 Full page');

  // ── Step 6: UAT check ──
  const result = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      hasKLine:       t.includes('K 線圖') || t.includes('K線圖'),
      chartHasData:   !t.includes('暫無走勢數據'),
      hasFearIndex:   t.includes('恐慌指數'),
      hasOptionsFlow: t.includes('期權多空比'),
      hasSentiment:   t.includes('市場情緒'),
      hasStrategy:    t.includes('策略對沖'),
      hasKeyInsights: t.includes('個股解讀'),
      hasBullBear:    t.includes('偏樂觀') && t.includes('偏謹慎'),
      hasPlatformBars: t.includes('Reddit') || t.includes('Polymarket') || t.includes('Buzz:'),
      sentimentCardText: document.querySelector('.lg\\:col-span-4 .bg-white')?.innerText || 'Not found',
      price:          t.match(/\$[\d,]+\.\d+/)?.[0] || 'N/A',
      pct:            t.match(/[+-][\d.]+%/)?.[0] || 'N/A',
    };
  });

  console.log('\n━━━━━━ UAT REPORT ━━━━━━');
  const check = (label, val) => console.log(`${val ? '✅' : '❌'} ${label}`);
  check('K線圖 section present',       result.hasKLine);
  check('Chart has OHLC data',         result.chartHasData);
  check('恐慌指數 (VIX)',               result.hasFearIndex);
  check('期權多空比 (Options Flow)',     result.hasOptionsFlow);
  check('市場情緒指數',                  result.hasSentiment);
  check('策略對沖與點位',                result.hasStrategy);
  check('個股解讀 (Key Insights)',       result.hasKeyInsights);
  check('進階情緒分析 (分平台數據)',   result.hasPlatformBars);
  console.log(`\n💰 Price: ${result.price}   📈 Change: ${result.pct}`);
  console.log(`\n📁 Screenshots: ${SCREENSHOTS_DIR}`);

  await browser.close();
})();
