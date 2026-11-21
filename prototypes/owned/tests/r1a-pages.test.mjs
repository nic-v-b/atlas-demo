import test from 'node:test';
import assert from 'node:assert/strict';
import {frontendHarness,settle} from './frontend-harness.mjs';
import {createAppServer} from '../backend/server.mjs';
import {buildUnifiedSyntheticViews} from '../backend/r1a-unified.mjs';
import {getUnifiedSyntheticJournal} from '../backend/r1a-journal.mjs';

const JOURNAL='SYN-R1A-CANONICAL';
const KEY='atlas-synthetic-account-selection-v1';
async function resolveUI(h,data){
  h.requests.at(-1).resolve(data);
  await settle();await settle();
}
async function withServer(fn){
  const server=createAppServer();
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
  });
  const base='http://127.0.0.1:'+server.address().port;
  try{return await fn(base);}
  finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}

test('ordinary three-page frontend scripts use one canonical journal route',()=>withServer(async base=>{
  const pages=[['/','/app.js'],['/holdings','/holdings.js'],['/tax-lab','/tax-lab.js']];
  for(const [page,script] of pages){
    assert.equal((await fetch(base+page)).status,200);
    const js=await (await fetch(base+script)).text();
    assert.match(js,/fetch\('\/api\/r1a\/state/);
    assert.doesNotMatch(js,/fetch\('\/api\/(?:holdings|tax-lab|summary)/);
  }
  const view=await (await fetch(base+'/api/r1a/state')).json();
  assert.equal(view.journalId,JOURNAL);
  assert.equal(view.overview.cadEquivalent,'24652.60');
  assert.equal(view.holdings.cadEquivalent,'24652.60');
  assert.equal(view.taxLab.before.cost,'CA$2200.00');
  assert.equal(view.taxLab.after.cost,'CA$1650.00');
  assert.equal(view.taxLab.sale.preliminaryGain,'CA$198.00');
  assert.equal(view.reconciliation.matched,true);
  assert.equal(view.holdings.positions.length,7);
  // Earlier standalone endpoints are still available for R0g research tests;
  // they are no longer called by the normal three-page user interface.
  const legacy=await (await fetch(base+'/api/holdings')).json();
  assert.equal(legacy.cadEquivalent,'19579.60');
}));

test('Overview renders independent golden amounts and journal-derived daily takeaway',async()=>{
  const h=await frontendHarness('app.js','index.html');
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].url,'/api/r1a/state');
  await resolveUI(h,buildUnifiedSyntheticViews());
  assert.equal(h.node('overview-total').textContent,'CA$24,652.60');
  assert.equal(h.node('native-cad').textContent,'CA$20,473.00');
  assert.equal(h.node('native-usd').textContent,'US$3,096.00');
  assert.equal(h.node('headline').textContent,'Why is cash this high?');
  assert.equal(h.node('signal').textContent,'REVIEW');
  assert.equal(h.node('tech').textContent,'10.8%');
  assert.equal(h.node('issuer').textContent,'21.9%');
  assert.match(h.node('issuerfoot').textContent,/United States/);
  assert.match(h.node('overview-fx').textContent,/1 USD = 1.35 CAD/);
  assert.equal(h.node('overview-cash').textContent,'CA$15,749.60');
  assert.equal(h.node('overview-invested').textContent,'CA$8,903.00');
  const rows=h.node('legend').children;
  assert.equal(rows.length,4);
  assert.ok(rows.some(r=>r.textContent.includes('CA$15,749.60 · 63.9%')));
  assert.ok(rows.some(r=>r.textContent.includes('CA$4,800.00 · 19.5%')));
  assert.equal(h.requests.length,1);
  assert.doesNotMatch(h.html,/id="trend"|id="scenario"/);
});

test('Holdings selection carries to Overview without changing owner-wide taxable ACB',async()=>{
  const storage=new Map();
  const holdings=await frontendHarness('holdings.js','holdings.html',{storage});
  assert.equal(holdings.requests[0].url,'/api/r1a/state');
  await resolveUI(holdings,buildUnifiedSyntheticViews());
  assert.equal(holdings.node('cad-equivalent').textContent,'CA$24,652.60');
  assert.equal(holdings.buttons().length,4);
  const usdRow=holdings.node('h-position-rows').children.find(row=>row.children[0].textContent.includes('SYNUSD01'));
  assert.deepEqual(usdRow.children.slice(5,7).map(cell=>cell.textContent),['US$1,680.00','CA$2,268.00']);
  const filtered=['SYN-CAD-TFSA','SYN-USD-TEST','SYN-CAD-TAX-B'];
  holdings.buttons()[0].click();
  assert.equal(holdings.requests.length,2);
  assert.equal(holdings.requests[1].url,
    '/api/r1a/state?accounts='+encodeURIComponent(filtered.join(',')));
  const chosen=buildUnifiedSyntheticViews(undefined,{accountIds:filtered});
  await resolveUI(holdings,chosen);
  assert.equal(holdings.node('cad-equivalent').textContent,'CA$14,139.60');
  assert.equal(storage.get(KEY),JSON.stringify(filtered));
  const overview=await frontendHarness('app.js','index.html',{storage});
  assert.equal(overview.requests[0].url,
    '/api/r1a/state?accounts='+encodeURIComponent(filtered.join(',')));
  await resolveUI(overview,chosen);
  assert.equal(overview.node('overview-total').textContent,'CA$14,139.60');
  assert.equal(overview.node('overview-selection').textContent,'3 of 4 fictional accounts selected');
  assert.equal(chosen.taxLab.after.cost,'CA$1650.00');
  assert.equal(chosen.taxLab.sale.preliminaryGain,'CA$198.00');
});

test('Tax Lab displays the same journal sale and pooled cost irrespective of selected account',async()=>{
  const storage=new Map([[KEY,JSON.stringify(['SYN-CAD-TFSA'])]]);
  const h=await frontendHarness('tax-lab.js','acb-lab.html',{storage});
  assert.equal(h.requests[0].url,'/api/r1a/state');
  await resolveUI(h,buildUnifiedSyntheticViews());
  assert.equal(h.node('acb-before-units').textContent,'20');
  assert.equal(h.node('acb-before-cost').textContent,'CA$2200.00');
  assert.equal(h.node('acb-before-average').textContent,'CA$110.00');
  assert.equal(h.node('acb-sale-gain').textContent,'CA$198.00');
  assert.match(h.node('acb-after-desc').textContent,/15 taxable shares remain with CA\$1650\.00 pooled ACB/);
  assert.equal(h.node('acb-timeline').children.length,3);
  assert.equal(h.node('acb-status').textContent,'CALCULATED');
  assert.match(h.html,/SOURCE: SHARED SYNTHETIC JOURNAL/);
  assert.equal(h.requests.length,1);
});

test('missing dated FX withholds combined totals and exposure rather than inventing conversions',async()=>{
  const journal=getUnifiedSyntheticJournal();
  delete journal.valuationFx;
  const payload=buildUnifiedSyntheticViews(journal);
  assert.equal(payload.overview.cadEquivalent,null);
  const h=await frontendHarness('app.js','index.html');
  await resolveUI(h,payload);
  assert.equal(h.node('overview-total').textContent,'Unavailable');
  assert.equal(h.node('overview-cash').textContent,'Unavailable');
  assert.equal(h.node('overview-invested').textContent,'Unavailable');
  assert.equal(h.node('native-cad').textContent,'CA$20,473.00');
  assert.equal(h.node('native-usd').textContent,'US$3,096.00');
  assert.equal(h.node('tech').textContent,'—');
  assert.equal(h.node('issuer').textContent,'—');
  assert.match(h.node('legend').textContent,/No comparable combined portfolio weights/);
  assert.equal(h.node('allocation').children.length,0);
  assert.equal(h.node('decision').textContent,'Unavailable');
});

test('temporary Overview failure retains saved selection without requesting all accounts',async()=>{
  const storage=new Map([[KEY,JSON.stringify(['SYN-CAD-TFSA'])]]);
  const h=await frontendHarness('app.js','index.html',{storage});
  h.requests[0].httpFailure();await settle();
  assert.equal(storage.get(KEY),JSON.stringify(['SYN-CAD-TFSA']));
  assert.equal(h.requests.length,1);
  assert.equal(h.node('overview-total').textContent,'Unavailable');
  h.node('retry-load').click();
  assert.equal(h.requests[1].url,'/api/r1a/state?accounts=SYN-CAD-TFSA');
  await resolveUI(h,buildUnifiedSyntheticViews(undefined,{accountIds:['SYN-CAD-TFSA']}));
  assert.equal(h.node('overview-total').textContent,'CA$5,110.00');
});

test('conflicting journal projections fail closed on every ordinary page',async()=>{
  const payload=buildUnifiedSyntheticViews();
  payload.taxLab.journalId='SYN-DIFFERENT-JOURNAL';
  const overview=await frontendHarness('app.js','index.html');
  await resolveUI(overview,payload);
  assert.equal(overview.node('overview-total').textContent,'Unavailable');
  assert.equal(overview.node('headline').textContent,'Portfolio evidence unavailable');
  const holdings=await frontendHarness('holdings.js','holdings.html');
  await resolveUI(holdings,payload);
  assert.equal(holdings.node('cad-equivalent').textContent,'Unavailable');
  assert.equal(holdings.node('h-error').hidden,false);
  const tax=await frontendHarness('tax-lab.js','acb-lab.html');
  await resolveUI(tax,payload);
  assert.equal(tax.node('acb-status').textContent,'DATA UNAVAILABLE');
  assert.equal(tax.node('acb-error').hidden,false);
});

test('confirmed invalid Holdings selection requires an explicit all-account choice',async()=>{
  const storage=new Map([[KEY,JSON.stringify(['SYN-NONEXISTENT'])]]);
  const h=await frontendHarness('holdings.js','holdings.html',{storage});
  h.requests[0].httpFailure(400,{schemaVersion:1,synthetic:true,journalId:JOURNAL,
    code:'INVALID_ACCOUNT_SELECTION',requestedAccountIds:['SYN-NONEXISTENT']});await settle();
  assert.equal(storage.get(KEY),JSON.stringify(['SYN-NONEXISTENT']));
  assert.equal(h.requests.length,1);
  assert.equal(h.node('cad-equivalent').textContent,'Unavailable');
  assert.match(h.node('h-error').textContent,/Choose valid fictional accounts/);
  h.node('select-all').click();
  assert.equal(h.requests[1].url,'/api/r1a/state');
  await resolveUI(h,buildUnifiedSyntheticViews());
  assert.equal(h.node('cad-equivalent').textContent,'CA$24,652.60');
  assert.equal(h.node('h-error').hidden,true);
  assert.equal(h.buttons().length,4);
});
