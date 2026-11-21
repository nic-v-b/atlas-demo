import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createAppServer} from '../backend/server.mjs';
import {buildUnifiedSyntheticViews} from '../backend/r1a-unified.mjs';
import {getUnifiedSyntheticJournal} from '../backend/r1a-journal.mjs';
import {frontendHarness,settle} from './frontend-harness.mjs';

const view=(ids=null,f=getUnifiedSyntheticJournal())=>buildUnifiedSyntheticViews(f,{accountIds:ids});
async function loadedHoldings(){
  const h=await frontendHarness('holdings.js','holdings.html');
  h.requests[0].resolve(view());await settle();return h;
}
function assertSelection(h,ids){
  const d=view(ids).holdings,money=(s,c)=>(c==='CAD'?'CA$':'US$')+Number(s).toLocaleString('en-CA',{minimumFractionDigits:2,maximumFractionDigits:2});
  assert.deepEqual(h.buttons().filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.account),ids);
  assert.equal(h.node('selected-count').textContent,d.accountCount+' selected account'+(d.accountCount===1?'':'s'));
  assert.equal(h.node('cad-equivalent').textContent,money(d.cadEquivalent,'CAD'));
  for(const c of ['CAD','USD']){
    assert.equal(h.node(c.toLowerCase()+'-total').textContent,money(d.currencyTotals[c].total,c));
    assert.equal(h.node(c.toLowerCase()+'-cash').textContent,money(d.currencyTotals[c].cash,c));
    assert.equal(h.node(c.toLowerCase()+'-positions').textContent,money(d.currencyTotals[c].positionValue,c));
  }
  assert.equal(h.node('h-position-rows').childElementCount,d.positions.length);
  assert.deepEqual(h.node('h-position-rows').children.map(r=>r.children[0].children[0].textContent),d.positions.map(p=>p.symbol));
  assert.deepEqual(h.node('h-position-rows').children.map(r=>r.children[1].ownText),d.positions.map(p=>p.accountLabel));
  assert.equal(h.node('h-account-details').childElementCount,d.accountCount);
}
const all=['SYN-CAD-TAX','SYN-CAD-TFSA','SYN-USD-TEST','SYN-CAD-TAX-B'];
test('latest account request failure restores committed filters, totals, count and positions',async()=>{
  const h=await loadedHoldings();
  h.buttons()[0].click();
  assert.equal(h.node('account-filters').getAttribute('aria-busy'),'true');
  assert.equal(h.node('selected-count').textContent,'Updating account selection…');
  h.requests[1].httpFailure();await settle();
  assertSelection(h,all);assert.equal(h.node('h-error').hidden,false);
  assert.equal(h.node('account-filters').getAttribute('aria-busy'),'false');
  assert.match(h.node('h-error').textContent,/Unable/);
});
test('earlier account request failure after later success cannot restore obsolete state',async()=>{
  const h=await loadedHoldings();
  h.buttons()[0].click();h.buttons()[1].click();
  h.requests[2].resolve(view(['SYN-USD-TEST','SYN-CAD-TAX-B']));await settle();
  h.requests[1].reject(Error('fictional offline error'));await settle();
  assertSelection(h,['SYN-USD-TEST','SYN-CAD-TAX-B']);assert.equal(h.node('h-error').hidden,true);
});
test('failed initial load withholds all portfolio figures and shows no false FX diagnosis',async()=>{
  const h=await frontendHarness('holdings.js','holdings.html');
  h.requests[0].httpFailure();await settle();
  assert.equal(h.node('h-error').hidden,false);assert.equal(h.buttons().length,0);
  for(const id of ['cad-equivalent','cad-total','usd-total','cad-cash','usd-cash','cad-positions','usd-positions']){
    assert.equal(h.node(id).textContent,'Unavailable');
  }
  assert.equal(h.node('selected-count').textContent,'Account selection unavailable');
  assert.doesNotMatch(h.node('h-legend').textContent,/FX|exchange rate|valuation rate/);
  assert.equal(h.node('h-position-rows').textContent,'Portfolio figures are unavailable.');
});
test('rapid account changes ignore stale successes and stale response bodies',async()=>{
  const h=await loadedHoldings();
  let resolveBody;
  h.buttons()[0].click();
  h.requests[1].headers(()=>new Promise(resolve=>{resolveBody=resolve;}));await settle();
  h.buttons()[1].click();h.node('select-all').click();
  h.requests[3].resolve(view());await settle();
  h.requests[2].resolve(view(['SYN-USD-TEST','SYN-CAD-TAX-B']));
  resolveBody(view(['SYN-CAD-TFSA','SYN-USD-TEST','SYN-CAD-TAX-B']));await settle();
  assertSelection(h,all);assert.equal(h.node('h-error').hidden,true);
});
test('latest failure after rapid changes restores last rendered selection despite stale success',async()=>{
  const h=await loadedHoldings();
  h.buttons()[0].click();h.requests[1].resolve(view(['SYN-CAD-TFSA','SYN-USD-TEST','SYN-CAD-TAX-B']));await settle();
  h.buttons()[1].click();h.buttons()[0].click();
  h.requests[3].reject(Error('fictional request failure'));await settle();
  h.requests[2].resolve(view(['SYN-USD-TEST','SYN-CAD-TAX-B']));await settle();
  assertSelection(h,['SYN-CAD-TFSA','SYN-USD-TEST','SYN-CAD-TAX-B']);assert.equal(h.node('h-error').hidden,false);
});
test('successful retry after account failure commits the requested selection and clears the error',async()=>{
  const h=await loadedHoldings();
  h.buttons()[0].click();h.requests[1].httpFailure();await settle();
  h.buttons()[0].click();
  assert.equal(h.requests[2].url,'/api/r1a/state?accounts=SYN-CAD-TFSA%2CSYN-USD-TEST%2CSYN-CAD-TAX-B');
  h.requests[2].resolve(view(['SYN-CAD-TFSA','SYN-USD-TEST','SYN-CAD-TAX-B']));await settle();
  assertSelection(h,['SYN-CAD-TFSA','SYN-USD-TEST','SYN-CAD-TAX-B']);assert.equal(h.node('h-error').hidden,true);
});
test('last selected account cannot be removed without changing the rendered portfolio',async()=>{
  const h=await loadedHoldings();
  h.buttons()[0].click();h.buttons()[1].click();h.buttons()[3].click();
  h.requests[3].resolve(view(['SYN-USD-TEST']));await settle();
  h.requests[1].reject(Error('stale'));h.requests[2].reject(Error('stale'));await settle();
  h.buttons()[2].click();
  assert.equal(h.requests.length,4);assertSelection(h,['SYN-USD-TEST']);
  assert.match(h.node('h-error').textContent,/at least one/);
});
for(const withFx of [true,false]){
  test('empty Holdings renders zero totals and empty explanations '+(withFx?'with':'without')+' FX',async()=>{
    const storage=new Map([['atlas-synthetic-account-selection-v1',JSON.stringify(['SYN-EMPTY'])]]);
    const h=await frontendHarness('holdings.js','holdings.html',{storage}),f=getUnifiedSyntheticJournal();
    f.accounts.push({id:'SYN-EMPTY',ownerId:'SYN-OWNER-EMPTY',label:'Fictional empty account',type:'tfsa',currency:'CAD'});if(!withFx)delete f.valuationFx;
    h.requests[0].resolve(view(['SYN-EMPTY'],f));await settle();
    assert.equal(h.node('cad-equivalent').textContent,'CA$0.00');
    assert.equal(h.node('cad-total').textContent,'CA$0.00');
    assert.equal(h.node('usd-total').textContent,'US$0.00');
    assert.equal(h.node('insight-state').textContent,'EMPTY');
    assert.match(h.node('h-legend').textContent,/empty|no cash or positions/i);
    for(const id of ['insight-text','h-legend','h-coverage','allocation-note','fx-note']){
      assert.doesNotMatch(h.node(id).textContent,/requires?.*(FX|rate)|without.*FX|No same-date|No verified/);
    }
    assert.equal(h.node('h-error').hidden,true);
    h.node('tab-sector').click();
    assert.match(h.node('h-legend').textContent,/empty|no cash or positions/i);
  });
}
test('Tax Lab captions and formulas agree with fictional 10.25-unit / CAD 50 purchases',async()=>{
  const f=getUnifiedSyntheticJournal();
  const buy=f.events.find(e=>e.type==='buy'&&e.securityId==='SYN-EQUITY-1'&&e.accountId==='SYN-CAD-TAX');
  buy.quantity='10.25';buy.unitPrice='20';buy.fee='0';
  f.events.find(e=>e.id==='SYN-R1A-BUY-B').unitPrice='50';
  const sale=f.events.find(e=>e.id==='SYN-R1A-SELL-A');sale.unitPrice='30';sale.fee='0';
  const d=buildUnifiedSyntheticViews(f),h=await frontendHarness('tax-lab.js','acb-lab.html');
  h.requests[0].resolve(d);await settle();
  assert.equal(h.node('acb-before-units').textContent,'20.25');
  assert.equal(h.node('acb-before-cost').textContent,'CA$705.00');
  assert.equal(h.node('acb-before-average').textContent,'CA$34.81');
  assert.equal(h.node('acb-sale-gain').textContent,'-CA$24.07');
  assert.match(h.node('acb-a-detail').textContent,/10\.25 shares/);
  assert.match(h.node('acb-b-detail').textContent,/CA\$50\.00/);
  assert.match(h.node('acb-after-desc').textContent,/15\.25.*CA\$530\.93.*CA\$34\.81/);
  assert.doesNotMatch(h.html,/10 in each taxable account|600 ÷ 20 shares|CA\$10|CA\$15|CA\$20/);
  // A formula using the rounded 34.81 average would imply -24.05, not -24.07.
  assert.doesNotMatch(h.node('acb-correct-formula').textContent,/×.*CA\$34\.81/);
  assert.match(h.node('acb-correct-formula').textContent,/pooled ACB/);
});

async function withSyntheticServer(fn){
  const server=createAppServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port;
  try{return await fn(base);}
  finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
}
test('new original Holdings route and local JS/CSS load with no external scripts',()=>withSyntheticServer(async base=>{
  const res=await fetch(base+'/holdings');
  assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'no-store');
  assert.match(res.headers.get('content-security-policy')??'',/connect-src 'self'/);
  const html=await res.text();
  assert.match(html,/What do I hold, and where\?/);
  assert.match(html,/SYNTHETIC MODE/);
  assert.match(html,/href="\/tax-lab"/);
  assert.match(html,/class="workspace-nav"/);
  assert.match(html,/id="account-filters"/);
  assert.doesNotMatch(html,/https?:\/\/|localStorage|access_token|personalAccountNumber/);
  assert.match(await (await fetch(base+'/holdings.css')).text(),/\.h-hero/);
  assert.match(await (await fetch(base+'/holdings.js')).text(),/api\/r1a\/state/);
}));
test('local Holdings API returns correct deterministic default totals and native position rows',()=>withSyntheticServer(async base=>{
  const res=await fetch(base+'/api/holdings');
  assert.equal(res.status,200);
  const d=await res.json();
  assert.equal(d.synthetic,true);
  assert.equal(d.taxReady,false);
  assert.equal(d.cadEquivalent,'19579.60');
  assert.equal(d.currencyTotals.CAD.total,'15400.00');
  assert.equal(d.currencyTotals.USD.total,'3096.00');
  assert.equal(d.accountCount,3);
  assert.equal(d.positions.length,6);
  assert.ok(d.positions.every(p=>p.symbol.startsWith('SYN')));
  assert.equal('actualAccountData' in d,false);
  assert.equal('rawJournal' in d,false);
}));
test('account filter genuinely changes BOTH native pockets and visible positions',()=>withSyntheticServer(async base=>{
  const [tfsa,usd,both]=await Promise.all([
    fetch(base+'/api/holdings?accounts=SYN-CAD-TFSA').then(r=>r.json()),
    fetch(base+'/api/holdings?accounts=SYN-USD-TEST').then(r=>r.json()),
    fetch(base+'/api/holdings?accounts=SYN-CAD-TAX%2CSYN-USD-TEST').then(r=>r.json())
  ]);
  assert.equal(tfsa.currencyTotals.CAD.total,'5110.00');
  assert.equal(tfsa.positions.length,2);
  assert.equal(usd.currencyTotals.USD.total,'3096.00');
  assert.equal(usd.positions.length,1);
  assert.equal(both.currencyTotals.CAD.total,'10290.00');
  assert.equal(both.currencyTotals.USD.total,'3096.00');
  assert.equal(both.positions.length,4);
}));
test('synthetic HTTP endpoints reject writes, malformed filters and arbitrary monetary query injection',()=>withSyntheticServer(async base=>{
  for(const target of [
    '/api/holdings?accounts=SYN-NOT-IN-FIXTURE',
    '/api/holdings?accounts=SYN-CAD-TAX%2CSYN-CAD-TAX',
    '/api/holdings?accounts=',
    '/api/holdings?accountBalance=12345',
    '/api/tax-lab?ownerAccountBalance=100000'
  ]){
    const r=await fetch(base+target);
    assert.equal(r.status,400,target);
  }
  assert.equal((await fetch(base+'/api/holdings',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/tax-lab',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/no-such-account.json')).status,404);
}));
test('Tax Lab API is driven by R0f oracle, not its previous hardcoded markup',()=>withSyntheticServer(async base=>{
  const api=await fetch(base+'/api/tax-lab');
  assert.equal(api.status,200);
  const d=await api.json();
  assert.equal(d.taxReady,false);
  assert.equal(d.before.cost,'CA$600.00');
  assert.equal(d.after.cost,'CA$450.00');
  assert.equal(d.sale.preliminaryGain,'CA$0.00');
  assert.equal(d.timeline.length,3);
  const html=await (await fetch(base+'/tax-lab')).text();
  assert.match(html,/src="\/tax-lab.js"/);
  assert.match(html,/id="acb-before-cost">—/);
  assert.match(html,/id="acb-timeline"/);
  assert.match(await (await fetch(base+'/tax-lab.js')).text(),/api\/r1a\/state/);
}));
test('workspace navigation exposes Overview, Holdings and Tax Lab across all three pages',()=>withSyntheticServer(async base=>{
  for(const page of ['/','/holdings','/tax-lab']){
    const html=await (await fetch(base+page)).text();
    const nav=html.match(/<nav class="workspace-nav"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(nav,'no mobile navigation on '+page);
    for(const dest of ['/', '/holdings','/tax-lab']){
      assert.ok(nav.includes('href="'+dest+'"'),'missing '+dest+' from '+page);
    }
    assert.ok(nav.includes('aria-current="page"'),'no current-page marker at '+page);
  }
}));


test('Tax Lab now has shared theme toggle, persistent preference and shared notebook tokens',async()=>{
  const [home,holdings,tax,csv,src,styles,shared]=await Promise.all(
    ['index.html','holdings.html','acb-lab.html','import.html','theme.js','acb-lab.css','styles.css']
      .map(file=>readFile(new URL('../web/'+file,import.meta.url),'utf8'))
  );
  for(const html of [home,holdings,tax,csv]){
    assert.match(html,/id="theme"/);
    assert.match(html,/<body class="light">/);
  }
  assert.match(src,/atlas-theme-preference-v1/);
  assert.doesNotMatch(src,/portfolio|accountBalance|access_token/i);
  assert.match(tax,/color-scheme" content="dark light"/);
  assert.match(styles,/\.acb-hero\s*\{[^}]*background:\s*var\(--wash\)/);
  assert.match(styles,/\.acb-panel\s*\{[^}]*var\(--stroke\)/);
  assert.match(styles,/\.acb-warning\s*\{[^}]*background:\s*var\(--caution-wash\)/);
  assert.match(shared,/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--accent\)/);
  const light=shared.match(/:root\s*\{([^}]+)\}/)?.[1]??'';
  const dark=shared.match(/body:not\(\.light\)\s*\{([^}]+)\}/)?.[1]??'';
  for(const token of ['wash','stroke','caution-wash','accent']){
    const pattern=new RegExp('--'+token+':\\s*(#[a-f0-9]{6})','i');
    assert.match(light,pattern);
    assert.match(dark,pattern);
    assert.notEqual(light.match(pattern)[1],dark.match(pattern)[1]);
  }

  const key='atlas-theme-preference-v1';
  const saved=new Map();
  function mountTheme(){
    let isLight=true,click;
    const attributes=new Map();
    const button={setAttribute:(name,value)=>attributes.set(name,value),
      addEventListener:(event,handler)=>{assert.equal(event,'click');click=handler;}};
    const classList={contains:name=>name==='light'&&isLight,
      toggle:(name,force)=>{assert.equal(name,'light');isLight=force??!isLight;}};
    const context={
      document:{body:{classList},getElementById:id=>id==='theme'?button:null},
      window:{localStorage:{getItem:name=>saved.get(name),setItem:(name,value)=>saved.set(name,value)}}
    };
    runInNewContext(src.replace('export function','function')+'\ninitializeAtlasTheme();',context);
    return {attributes,click};
  }
  const first=mountTheme();
  assert.equal(first.attributes.get('aria-label'),'Switch to dark theme');
  assert.equal(first.attributes.get('aria-pressed'),'true');
  assert.equal(saved.size,0);
  first.click();
  assert.deepEqual([...saved],[[key,'dark']]);
  const reloaded=mountTheme();
  assert.equal(reloaded.attributes.get('aria-label'),'Switch to light theme');
  assert.equal(reloaded.attributes.get('aria-pressed'),'false');
  reloaded.click();
  assert.deepEqual([...saved],[[key,'light']]);
  assert.equal(reloaded.attributes.get('aria-pressed'),'true');
});
test('Holdings exposure tabs and HTTP payload expose account-filtered ETF, sector and regional look-through',()=>withSyntheticServer(async base=>{
  const html=await (await fetch(base+'/holdings')).text();
  assert.match(html,/role="tablist" aria-label="Portfolio composition dimension"/);
  for(const dimension of ['vehicle','strategy','sector','geography']){
    assert.match(html,new RegExp('data-exposure="'+dimension+'"'));
  }
  assert.match(html,/id="h-etf-mix"/);
  // Text-only concentration metrics were intentionally replaced with analytics charts.
  assert.doesNotMatch(html,/id="h-concentration"/);
  assert.match(html,/id="h-sector-donut"/);
  assert.match(html,/id="h-sector-key"/);
  assert.match(html,/id="h-target-bars"/);
  const all=await (await fetch(base+'/api/holdings')).json();
  assert.equal(all.exposure.synthetic,true);
  assert.equal(all.exposure.etfMix.length,2);
  assert.deepEqual(all.exposure.etfMix.map(x=>x.valueCad),['3200.00','1600.00']);
  assert.equal(all.exposure.dimensions.sector.find(x=>x.key==='technology').valueCad,'2660.00');
  assert.equal(all.exposure.dimensions.geography.find(x=>x.key==='us').valueCad,'5408.00');
  const only=await (await fetch(base+'/api/holdings?accounts=SYN-USD-TEST')).json();
  assert.equal(only.exposure.etfMix.length,0);
  assert.equal(only.exposure.dimensions.sector.find(x=>x.key==='healthcare').percentOfInvested,100);
}));


test('Overview now uses unified journal while legacy scenario API remains research-only',()=>withSyntheticServer(async base=>{
  const html=await (await fetch(base+'/')).text();
  assert.match(html,/Shared fictional event journal/);
  assert.match(html,/id="overview-total"/);
  assert.match(html,/Historical portfolio performance is not available in R1a/);
  assert.doesNotMatch(html,/id="scenario"|id="trend"/);
  const js=await (await fetch(base+'/app.js')).text();
  assert.match(js,/api\/r1a\/state/);
  assert.doesNotMatch(js,/api\/summary/);
  const routine=await (await fetch(base+'/api/summary?scenario=stable')).json();
  const risk=await (await fetch(base+'/api/summary?scenario=risk')).json();
  const stale=await (await fetch(base+'/api/summary?scenario=stale')).json();
  assert.equal(routine.takeaway.state,'stable');
  assert.equal(risk.takeaway.state,'risk');
  assert.equal(stale.takeaway.state,'stale');
}));
test('Portfolio Analytics exposes a sector donut, accessible sector legend, and target comparison rather than only text metrics',()=>withSyntheticServer(async base=>{
  const html=await (await fetch(base+'/holdings')).text();
  assert.match(html,/id="h-sector-donut"/);
  assert.match(html,/role="img" aria-label="Fictional sector exposure ring"/);
  assert.match(html,/id="h-sector-key"/);
  assert.match(html,/id="h-target-bars"/);
  assert.match(html,/Invented targets · Not investment advice/);
  assert.doesNotMatch(html,/LARGEST SECTOR · INVESTED/);
  const js=await (await fetch(base+'/holdings.js')).text();
  assert.match(js,/conic-gradient/);
  assert.match(js,/drawSectorVisuals\(exposure\)/);
  // R1a keeps the whole-dollar donut summary while allowing display-mode changes.
  // The separate interaction test verifies CA$ / % / Both against real DOM updates.
  assert.match(js,/const displayWholeCad=/);
  assert.match(js,/maximumFractionDigits:0/);
  assert.match(js,/displayWholeCad\(exposure\.investedValueCad\)/);
  assert.match(html,/data-value-mode="money"/);
  assert.match(html,/data-value-mode="percent"/);
  assert.match(html,/data-value-mode="both"/);
  assert.match(js,/drawTargetComparison\(exposure\)/);
  assert.match(js,/setAttribute\('aria-pressed'/);
  const css=await (await fetch(base+'/holdings.css')).text();
  assert.match(css,/\.h-sector-donut/);
  assert.match(css,/\.h-target-marker/);
}));
test('Fictional sector policy comparison is deterministic, selection-aware and separately excludes cash',()=>withSyntheticServer(async base=>{
  const all=await (await fetch(base+'/api/holdings')).json();
  const p=all.exposure.exampleSectorComparison;
  assert.equal(p.synthetic,true);
  assert.equal(p.rows.find(row=>row.key==='healthcare').deltaPp,12.8);
  assert.equal(p.rows.find(row=>row.key==='technology').actualPct,31.7);
  assert.match(p.source,/Invented targets/);
  const usd=await (await fetch(base+'/api/holdings?accounts=SYN-USD-TEST')).json();
  const health=usd.exposure.exampleSectorComparison.rows.find(row=>row.key==='healthcare');
  assert.equal(health.actualPct,100);
  assert.equal(health.deltaPp,80);
  assert.equal(usd.currencyTotals.USD.total,'3096.00');
  assert.equal(usd.currencyTotals.CAD.total,'0.00');
}));


test('Holdings UI guards nullable cash-only classification and ignores stale network failures',()=>withSyntheticServer(async base=>{
  const js=await (await fetch(base+'/holdings.js')).text();
  assert.match(js,/sectorCoverage===null\|\|geographyCoverage===null/);
  assert.match(js,/this fictional selection has no invested holdings/);
  assert.match(js,/if\(committedView\)render\(committedView\)/);
  assert.match(js,/if\(request!==requestCounter\)return/);
}));
test('Tax Lab frontend uses calculated selling account and the API returns that seller identity',()=>withSyntheticServer(async base=>{
  const js=await (await fetch(base+'/tax-lab.js')).text();
  assert.match(js,/d\.sale\.accountLetter/);
  assert.doesNotMatch(js,/'Sell '\+d\.sale\.quantity\+' shares from account A'/);
  const data=await (await fetch(base+'/api/tax-lab')).json();
  assert.equal(data.sale.accountLetter,'A');
  assert.equal(data.sale.quantity,'5');
  assert.equal(data.after.average,'CA$30.00');
}));
