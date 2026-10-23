const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const APP = process.env.SPX_UAT_APP_URL || 'http://localhost:5173';
const API = process.env.SPX_UAT_API_ORIGIN || 'http://127.0.0.1:8788';
const DIR = path.resolve('.tmp/spx-board-redesign');
const json = body => ({status:200,contentType:'application/json',body:JSON.stringify(body)});
const button = async (page,text) => {
  const handle=await page.evaluateHandle(t=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===t),text);
  assert.ok(handle.asElement(),`button ${text} must exist`);
  await handle.asElement().click();
};

(async()=>{
  fs.mkdirSync(DIR,{recursive:true});
  const fixture=await (await fetch(API+'/api/spx-gex-heatmap')).json();
  const pressure=await (await fetch(API+'/api/spx-gex-pressure?date='+fixture.selectedDate)).json();
  assert.equal(fixture.status,'READY'); assert.equal(pressure.status,'READY');
  const {buildSpxPriceActionCompassResponse}=await import('../src/lib/spx-price-action-compass.ts');
  const browser=await puppeteer.launch({headless:true});
  const evidence=[];
  const open=async(width=1440,height=900)=>{
    const page=await browser.newPage(); await page.setViewport({width,height,deviceScaleFactor:1});
    const state={fault:null,overlayFault:null,requests:[],errors:[],warnings:[],delayTimeframe:null};
    page.on('pageerror',e=>state.errors.push(e.message));
    page.on('console',m=>{if(m.type()==='warn')state.warnings.push(m.text());});
    await page.setRequestInterception(true);
    page.on('request',async req=>{
      const url=new URL(req.url());
      if(!url.pathname.startsWith('/api/spx-'))return req.continue();
      state.requests.push(url.pathname+url.search);
      const date=url.searchParams.get('date')||fixture.selectedDate;
      if(url.pathname==='/api/spx-gex-heatmap'){
        if(state.fault==='timeout')return; // Real AbortController/8-second request-lane timeout.
        if(state.fault)return req.respond(state.fault);
        const payload=structuredClone(fixture);
        payload.availableDates=[fixture.selectedDate,'2026-07-10'];
        payload.selectedDate=date;
        payload.sessions.forEach(s=>s.tradingDate=date);
        const minute=url.searchParams.get('snapshot');
        payload.selectedSnapshot=minute===null?payload.sessions.at(-1):payload.sessions.find(s=>s.snapshotMinuteEt===Number(minute));
        payload.heatmap.session=payload.selectedSnapshot;
        payload.heatmap.quote.last=payload.selectedSnapshot.spot;
        return req.respond(json(payload));
      }
      if(url.pathname==='/api/spx-gex-pressure'){
        const payload=structuredClone(pressure); payload.selectedDate=date; payload.pressure.tradingDate=date;
        return req.respond(json(payload));
      }
      if(url.pathname==='/api/spx-price-action-compass'){
        if(url.searchParams.get('view')==='price-overlay' && state.overlayFault) return req.respond(state.overlayFault);
        const tf=url.searchParams.get('timeframe')||'5m';
        const step=tf==='1m'?1:tf==='15m'?15:5;
        const candles=Array.from({length:Math.floor(390/step)+1},(_,i)=>{
          const close=fixture.heatmap.quote.last+Math.sin(i/4)*12;
          return {time:Date.parse(date+'T13:30:00Z')+i*step*60000,date_iso:date,open:close-1,high:close+2,low:close-2,close,volume:1000+i};
        });
        const source={provider:'test',label:'Deterministic local UAT',symbol:'SPX',range:'fixture',interval:tf,fetchedAt:date+'T20:15:00Z',status:'READY',note:'Synthetic fixture, not production market data.'};
        const payload=url.searchParams.get('view')==='price-overlay'?{ticker:'SPX',timeframe:'1m',candles,source,warnings:[]}:buildSpxPriceActionCompassResponse({timeframe:tf,candles,source});
        if(state.delayTimeframe===tf)await new Promise(r=>setTimeout(r,700));
        if(req.isInterceptResolutionHandled())return;
        try {return await req.respond(json(payload));} catch(e){if(!page.isClosed() && !/Invalid InterceptionId|Target closed|Session closed/.test(e.message))throw e;}
        return;
      }
      return req.continue();
    });
    return {page,state};
  };
  const waitReady=page=>page.waitForFunction(()=>document.querySelector('[data-spx-gex-request-state]')?.getAttribute('data-spx-gex-request-state')==='READY',{timeout:25000});
  try{
    for(const [name,w,h] of [['desktop',1440,900],['mobile',390,844]]){
      const {page,state}=await open(w,h);
      await page.goto(APP+'/#/work/spx-gex-heatmap?mode=latest',{waitUntil:'networkidle2'});
      await waitReady(page);
      await page.waitForFunction(()=>document.querySelector('[data-spx-board-pressure-summary] ol li'));
      await page.waitForSelector('[data-pa-chart-surface]');
      const overview=await page.$eval('[data-spx-board-overview]',e=>({text:e.innerText,bottom:e.getBoundingClientRect().bottom}));
      assert.match(overview.text,/Gamma flip/); assert.match(overview.text,/Call \/ put wall/); assert.match(overview.text,/vs 09:30 ET/);
      assert.ok(overview.bottom<h,'four-question overview must fit within the first viewport');
      assert.equal(await page.$eval('#spx-board-evidence',e=>e.open),false);
      assert.equal(await page.$eval('[data-spx-gex-navigation-mode]',e=>e.scrollWidth>e.clientWidth),false,'page must not overflow horizontally');
      assert.equal(await page.$eval('[data-spx-gex-heatmap-spot-badge]',e=>e.classList.contains('spx-spot-live-pulse')),false);
      await page.screenshot({path:path.join(DIR,'verified-'+name+'.png')});
      await button(page,'Inspect evidence →');
      assert.equal(await page.$eval('#spx-board-evidence',e=>e.open),true);
      assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('#spx-board-evidence summary')),true);
      await page.keyboard.press('Enter');
      assert.equal(await page.$eval('#spx-board-evidence',e=>e.open),false,'native details must support keyboard activation');
      state.delayTimeframe='1m';
      await button(page,'1M');
      await page.waitForFunction(()=>document.querySelector('[aria-pressed="true"]')!==null);
      await button(page,'15M');
      await page.waitForFunction(()=>document.querySelector('[data-pa-loaded-timeframe]')?.getAttribute('data-pa-loaded-timeframe')==='15m');
      await new Promise(r=>setTimeout(r,900));
      assert.equal(await page.$eval('[data-pa-loaded-timeframe]',e=>e.getAttribute('data-pa-loaded-timeframe')),'15m','obsolete response must not overwrite newer timeframe');
      // Rapid date changes must finish on the last selection, including pressure summary.
      await page.select('select[name="spx-gex-snapshot-date"]','2026-07-10');
      await page.select('select[name="spx-gex-snapshot-date"]',fixture.selectedDate);
      await waitReady(page);
      assert.equal(await page.$eval('select[name="spx-gex-snapshot-date"]',e=>e.value),fixture.selectedDate);
      state.fault={status:503,contentType:'text/html',body:'<html>injected edge failure</html>'};
      await button(page,'Latest retained');
      await page.waitForFunction(()=>document.querySelector('[data-spx-gex-request-state]')?.getAttribute('data-spx-gex-request-state')==='ERROR');
      assert.match(await page.$eval('[data-spx-board-overview]',e=>e.innerText),/Last verified/);
      assert.match(await page.$eval('[role="alert"]',e=>e.innerText),/Last verified:/);
      state.fault=null; await button(page,'Retry snapshot'); await waitReady(page);
      assert.deepEqual(state.errors,[],'healthy and recoverable flows must not crash React');
      evidence.push({name,overview,requests:state.requests,warnings:state.warnings,reactErrors:state.errors});
      await page.close();
    }
    const faults=[
      ['html-502',{status:502,contentType:'text/html',body:'<html>bad gateway</html>'},'NON_JSON_RESPONSE',2],
      ['html-503',{status:503,contentType:'text/html',body:'<html>unavailable</html>'},'NON_JSON_RESPONSE',2],
      ['empty-body',{status:200,contentType:'application/json',body:''},'EMPTY_RESPONSE',1],
      ['malformed-json',{status:200,contentType:'application/json',body:'{"status":'},'INVALID_JSON',1],
      ['schema',{status:200,contentType:'application/json',body:'{"status":"READY","heatmap":{}}'},'SCHEMA_INVALID',1],
      ['timeout','timeout',null,2],
    ];
    for(const [name,fault,code,count] of faults){
      const {page,state}=await open(); state.fault=fault;
      await page.goto(APP+'/#/work/spx-gex-heatmap?mode=latest',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('[data-spx-gex-request-state]')?.getAttribute('data-spx-gex-request-state')==='ERROR',{timeout:25000});
      assert.equal(state.requests.filter(p=>p.startsWith('/api/spx-gex-heatmap')).length,count,name+' retry count');
      if(code)assert.match(await page.$eval('#spx-board-evidence',e=>e.textContent),new RegExp(code));
      assert.equal(await page.$('[data-spx-board-overview]'),null,'invalid response must not produce fabricated market values');
      state.fault=null; await button(page,'Retry snapshot'); await waitReady(page);
      assert.deepEqual(state.errors,[]);
      evidence.push({name,classification:code||'request timeout',attempts:count,recovered:true});
      await page.close();
    }
    const {page,state}=await open();
    state.fault=json({...fixture,status:'EMPTY',heatmap:null,selectedSnapshot:null,sessions:[]});
    await page.goto(APP+'/#/work/spx-gex-heatmap?mode=latest',{waitUntil:'networkidle2'});
    await page.waitForFunction(()=>document.querySelector('[data-spx-gex-request-state]')?.getAttribute('data-spx-gex-request-state')==='EMPTY');
    assert.equal(await page.$('[data-spx-board-overview]'),null);
    state.fault=null; await button(page,'Latest retained'); await waitReady(page); await page.close();
    evidence.push({name:'EMPTY',recovered:true});
    const overlayCase=await open();
    overlayCase.state.overlayFault={status:503,contentType:'text/html',body:'<html>injected overlay failure without source metadata</html>'};
    await overlayCase.page.evaluateOnNewDocument(now=>{
      const RealDate=Date;
      globalThis.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} };
    },Date.parse(fixture.selectedDate+'T14:00:00Z'));
    await overlayCase.page.goto(APP+'/#/work/spx-gex-heatmap?mode=latest',{waitUntil:'domcontentloaded'});
    await waitReady(overlayCase.page);
    const overlayAttempts=()=>overlayCase.state.requests.filter(p=>p.includes('view=price-overlay')).length;
    const deadline=Date.now()+45_000;
    while(overlayAttempts()<8 && Date.now()<deadline) await new Promise(r=>setTimeout(r,200));
    assert.equal(overlayAttempts(),8,'initial read plus three recovery reads each permit one transport retry');
    await overlayCase.page.waitForFunction(()=>!document.querySelector('[data-spx-overlay-retry]')?.disabled);
    await overlayCase.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await new Promise(r=>setTimeout(r,500));
    assert.equal(overlayAttempts(),8,'visibility must not reset an exhausted recovery budget');
    overlayCase.state.overlayFault=null;
    await overlayCase.page.click('[data-spx-overlay-retry]');
    await overlayCase.page.waitForFunction(()=>!document.querySelector('[data-spx-price-overlay-diagnostics]') && Number(document.querySelector('[data-spx-gex-pressure-spot-line]')?.getAttribute('data-spx-gex-pressure-spot-point-count'))>0);
    assert.equal(overlayAttempts(),9,'explicit overlay retry must recover without reloading the board');
    assert.deepEqual(overlayCase.state.errors,[]);
    evidence.push({name:'overlay-without-provider-metadata',attempts:8,recovered:true});
    await overlayCase.page.close();
    fs.writeFileSync(path.join(DIR,'uat.json'),JSON.stringify(evidence,null,2));
    console.log('SPX Board redesign UAT PASS: desktop/mobile overview, evidence keyboard/focus, latest/pinned dates, timeframe cancellation, stale retention, EMPTY, HTML 502/503, empty/malformed/schema errors, real timeout and recovery.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
