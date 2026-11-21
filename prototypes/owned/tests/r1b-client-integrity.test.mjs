import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUnifiedSyntheticViews} from '../backend/r1a-unified.mjs';
import {getUnifiedSyntheticJournal} from '../backend/r1a-journal.mjs';
import {calculateSyntheticHoldings} from '../backend/holdings.mjs';
import {buildSyntheticTaxLabView} from '../backend/tax-lab-view.mjs';
import {createAppServer} from '../backend/server.mjs';
import {validateJournalResponse,readJournalResponse,InvalidAccountSelection,SELECTION_KEY} from '../web/journal-response.mjs';
import {frontendHarness,settle} from './frontend-harness.mjs';

const base=buildUnifiedSyntheticViews();
const chosen=['SYN-CAD-TFSA'];
const filtered=()=>buildUnifiedSyntheticViews(undefined,{accountIds:chosen});
const invalidSelection=ids=>({schemaVersion:1,synthetic:true,journalId:base.journalId,
  code:'INVALID_ACCOUNT_SELECTION',requestedAccountIds:ids});
const pages=[['app.js','index.html','overview-total','overview-error'],
  ['holdings.js','holdings.html','cad-equivalent','h-error'],
  ['tax-lab.js','acb-lab.html','acb-before-cost','acb-error']];
async function deliver(h,data,index=h.requests.length-1){h.requests[index].resolve(data);await settle();}
function setPath(object,path,value){
  const parts=path.split('.'),key=parts.pop();
  const parent=parts.reduce((o,k)=>o[k],object);
  if(value===undefined)delete parent[key];else parent[key]=value;
}

test('versioned validator accepts fresh JSON for every nonempty account subset, independent of order',()=>{
  const options=base.holdings.accountOptions.map(a=>a.id);
  for(let bits=1;bits<16;bits++){
    const accountIds=options.filter((_,i)=>bits&(1<<i)).reverse();
    const payload=buildUnifiedSyntheticViews(undefined,{accountIds});
    assert.equal(validateJournalResponse(JSON.parse(JSON.stringify(payload)),{accountIds}).schemaVersion,1);
    assert.equal(payload.journalRevision,base.journalRevision);
  }
});
test('content revision changes when the source journal changes and is shared by every projection',()=>{
  const journal=getUnifiedSyntheticJournal();journal.events.find(e=>e.id==='SYN-R1A-BUY-B').unitPrice='130';
  const payload=buildUnifiedSyntheticViews(journal);
  assert.notEqual(payload.journalRevision,base.journalRevision);
  for(const key of ['overview','holdings','taxLab'])assert.equal(payload[key].journalRevision,payload.journalRevision);
  validateJournalResponse(payload);
});
test('object key order is not part of the wire contract',()=>{
  const payload=JSON.parse(JSON.stringify(base));
  payload.overview.currencyTotals.CAD=Object.fromEntries(Object.entries(payload.overview.currencyTotals.CAD).reverse());
  validateJournalResponse(payload);
});
test('duplicate account detail rows cannot conceal a missing selected account',()=>{
  const payload=JSON.parse(JSON.stringify(base));payload.holdings.perAccount[1]=payload.holdings.perAccount[0];
  assert.throws(()=>validateJournalResponse(payload));
});
test('cash-only, tiny positive and missing-FX projections retain legitimate null and rounding semantics',()=>{
  for(const amount of ['100','0.000000000001']){
    const journal=getUnifiedSyntheticJournal();
    journal.accounts.push({id:'SYN-CASH-ONLY',ownerId:'SYN-CASH-OWNER',label:'Fictional cash only',type:'tfsa',currency:'CAD'});
    journal.events.push({id:'SYN-CASH-DEPOSIT',accountId:'SYN-CASH-ONLY',date:journal.asOf,seq:1,type:'deposit',currency:'CAD',amount});
    const payload=buildUnifiedSyntheticViews(journal,{accountIds:['SYN-CASH-ONLY']});
    assert.equal(payload.holdings.valuationState,'valued');
    validateJournalResponse(payload,{accountIds:['SYN-CASH-ONLY']});
  }
  const journal=getUnifiedSyntheticJournal();delete journal.valuationFx;
  validateJournalResponse(buildUnifiedSyntheticViews(journal));
  validateJournalResponse(buildUnifiedSyntheticViews(journal,{accountIds:chosen}),{accountIds:chosen});
});
const negatives=[
  ['schemaVersion',undefined],['schemaVersion',2],['synthetic',false],['journalId','SYN-WRONG'],
  ['journalRevision','old'],['holdings.journalRevision','f'.repeat(64)],['overview.journalRevision','e'.repeat(64)],
  ['taxLab.journalRevision','d'.repeat(64)],['holdings.journalId','SYN-WRONG'],['overview.journalId','SYN-WRONG'],
  ['taxLab.journalId','SYN-WRONG'],['reconciliation',undefined],['reconciliation.matched',false],
  ['reconciliation.matched',undefined],['reconciliation.taxableUnits','14'],['reconciliation.acbUnits','16'],
  ['selectionScope.kind','all'],['selectionScope.accountIds',['SYN-CAD-TFSA']],
  ['holdings.selectionScope.accountIds',['SYN-CAD-TFSA']],['overview.selectionScope.kind','taxable'],
  ['holdings.selectedAccountIds',[]],['holdings.selectedAccountIds',['SYN-MISSING']],
  ['holdings.accountOptions.0.id','REAL-ACCOUNT'],['holdings.accountCount',3],['holdings.perAccount',[]],
  ['holdings.positions.0.accountId','SYN-CAD-TFSA'],['holdings.positions.0.quoteAsOf','2026-01-01'],
  ['holdings.positions.0.currency','EUR'],['holdings.taxReady',true],['holdings.scope','production'],
  ['overview.asOf','2026-01-01'],['asOf','2026-02-30'],['holdings.fx.asOf','2026-01-01'],
  ['holdings.fx.rate','0'],['holdings.fx.rate',1.35],['holdings.currencyTotals.CAD.total',null],
  ['holdings.currencyTotals.CAD.cash',''],['holdings.currencyTotals.USD.positionValue',false],
  ['holdings.cadEquivalent','NaN'],['holdings.positions.0.unitQuote','1e3'],['holdings.positions.0.quantity','-1'],
  ['holdings.positions.0.bookValueNative',' 12.00'],['holdings.positions.0.marketValueNative',{}],
  ['holdings.positions.0.unrealizedNative','Infinity'],['holdings.exposure.etfMix.0.percentOfEtfs','50'],
  ['holdings.exposure.dimensions.geography.0.percentOfPortfolio',101],
  ['holdings.exposure.dimensions.strategy.0.percentOfInvested',3],
  ['holdings.exposure.coverage.sectorPctOfInvested',NaN],
  ['holdings.exposure.exampleSectorComparison.rows.0.deltaPp',Infinity],
  ['holdings.exposure.diagnostics.largestSector.percentOfPortfolio',-1],
  ['overview.cadEquivalent','1.00'],['overview.currencyTotals.USD.total','0.00'],
  ['taxScope.kind','selected-accounts'],['taxScope.ownerId','SYN-WRONG'],
  ['taxScope.identicalPropertyId','SYN-WRONG'],['taxScope.accountIds',['SYN-CAD-TAX']],
  ['taxLab.taxScope.accountIds',['SYN-CAD-TAX']],['taxLab.accounts.1',null],
  ['taxLab.accounts.1.pct','50'],['taxLab.accounts.1.accountId','SYN-CAD-TFSA'],
  ['taxLab.before.cost','2200.00'],['taxLab.before.cost','-CA$2200.00'],['taxLab.after.average',null],
  ['taxLab.sale.quantity','6'],['taxLab.sale.preliminaryGain','CA$NaN'],['taxLab.sale.pooledFormula',undefined],
  ['taxLab.timeline.2.detail',undefined],['taxLab.timeline.1.date','2026-02-30'],['taxLab.timeline',[]],
  ['taxLab.source','Unverified source'],['limitations',undefined],['unrecognized',true]
];
for(const [path,value] of negatives)test('reject malformed canonical response: '+path+' = '+String(value),()=>{
  const payload=JSON.parse(JSON.stringify(base));setPath(payload,path,value);
  assert.throws(()=>validateJournalResponse(payload),/response rejected/);
});
test('request scope cannot be enlarged, reduced or duplicated even by mutually consistent projections',()=>{
  for(const accountIds of [chosen,[],['SYN-CAD-TAX','SYN-CAD-TAX']])
    assert.throws(()=>validateJournalResponse(base,{accountIds}));
  assert.throws(()=>validateJournalResponse(filtered()),/response rejected/);
});
test('unvisited exposure tabs and late Tax Lab fields are checked before any page renders',()=>{
  for(const [path,value] of [['holdings.exposure.dimensions.geography.1.percentOfInvested','bad'],
    ['taxLab.timeline.2.title',null],['taxLab.sale.accountOnlyGain','bad']]){
    const payload=structuredClone(base);setPath(payload,path,value);assert.throws(()=>validateJournalResponse(payload));
  }
});

for(const [script,page,total,error] of pages){
  for(const kind of ['legacy holdings','legacy Tax Lab','missing reconciliation','bad late tax field','wrong revision']){
    test(script+' withholds every figure for '+kind,async()=>{
      let payload=structuredClone(base);
      if(kind==='legacy holdings')payload=calculateSyntheticHoldings(getUnifiedSyntheticJournal());
      if(kind==='legacy Tax Lab')payload=buildSyntheticTaxLabView();
      if(kind==='missing reconciliation')delete payload.reconciliation;
      if(kind==='bad late tax field')delete payload.taxLab.timeline[2].detail;
      if(kind==='wrong revision')payload.holdings.journalRevision='a'.repeat(64);
      const h=await frontendHarness(script,page);await deliver(h,payload);
      assert.equal(h.node(total).textContent,'Unavailable');assert.equal(h.node(error).hidden,false);
      assert.equal(h.requests.length,1);
      if(script==='tax-lab.js'){
        for(const id of ['acb-before-units','acb-sale-gain','acb-a-cost','acb-b-cost','acb-correct','acb-naive','acb-after-desc'])
          assert.equal(h.node(id).textContent,'Unavailable');
        assert.equal(h.node('acb-timeline').children.length,0);
        assert.equal(h.node('acb-a-bar').style.width,'0%');
        assert.equal(h.node('acb-cost-bar').getAttribute('aria-label'),'Purchase cost proportions unavailable');
      }
    });
  }
  for(const failure of ['network','503','400','JSON','malformed payload'])test(script+' preserves complete verified snapshot on '+failure,async()=>{
    const storage=new Map([[SELECTION_KEY,JSON.stringify(chosen)]]);
    const h=await frontendHarness(script,page,{storage});
    const payload=script==='tax-lab.js'?base:filtered();
    await deliver(h,payload);const before=h.node(total).textContent;
    h.node('retry-load').click();
    const req=h.requests.at(-1);
    if(failure==='network')req.reject(Error('Synthetic offline failure'));
    if(failure==='503')req.httpFailure();
    if(failure==='400')req.httpFailure(400);
    if(failure==='JSON')req.headers(async()=>{throw Error('Invalid JSON');});
    if(failure==='malformed payload'){const bad=structuredClone(payload);delete bad.taxLab.timeline[2].detail;req.resolve(bad);}
    await settle();
    assert.equal(h.node(total).textContent,before);assert.equal(h.node(error).hidden,false);
    assert.match(h.node(error).textContent,/stale/);assert.equal(storage.get(SELECTION_KEY),JSON.stringify(chosen));
    assert.equal(h.requests.length,2);
    if(script==='holdings.js')assert.deepEqual(h.buttons().filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.account),chosen);
    if(script==='tax-lab.js'){
      assert.match(h.node('acb-status').textContent,/STALE/);assert.equal(h.node('acb-timeline').children.length,3);
      assert.equal(h.node('acb-before-cost').textContent,'CA$2200.00');
      assert.equal(h.node('acb-correct').textContent,'CA$198.00');
    }
    h.node('retry-load').click();await deliver(h,payload);
    assert.equal(h.node(error).hidden,true);
  });
  for(const stale of ['success','failure','invalid selection','delayed body'])test(script+' ignores obsolete '+stale,async()=>{
    const h=await frontendHarness(script,page);
    let finishBody;
    if(stale==='delayed body'){
      h.requests[0].headers(()=>new Promise(resolve=>{finishBody=resolve;}));await settle();
    }
    h.node('retry-load').click();
    const journal=getUnifiedSyntheticJournal();journal.events.find(e=>e.id==='SYN-R1A-BUY-B').unitPrice='130';
    await deliver(h,buildUnifiedSyntheticViews(journal),1);
    const committed=h.node(total).textContent;
    if(stale==='success')h.requests[0].resolve(base);
    if(stale==='failure')h.requests[0].reject(Error('Obsolete failure'));
    if(stale==='invalid selection')h.requests[0].httpFailure(400,invalidSelection(chosen));
    if(stale==='delayed body')finishBody(base);
    await settle();
    assert.equal(h.node(total).textContent,committed);assert.equal(h.node(error).hidden,true);
    if(script==='tax-lab.js')assert.equal(committed,'CA$2300.00');
  });
}
for(const [script,page,total,error] of pages.slice(0,2)){
  test(script+' ignores delayed confirmed-invalid errors for an obsolete filtered request',async()=>{
    const storage=new Map([[SELECTION_KEY,JSON.stringify(chosen)]]);
    const h=await frontendHarness(script,page,{storage});
    let finishError;
    h.requests[0].httpHeaders(400,()=>new Promise(resolve=>{finishError=resolve;}));await settle();
    h.node('retry-load').click();await deliver(h,filtered(),1);
    finishError(invalidSelection(chosen));
    await settle();assert.equal(h.node(error).hidden,true);
    assert.equal(storage.get(SELECTION_KEY),JSON.stringify(chosen));
    assert.equal(h.requests.length,2);
  });
  for(const failure of ['network','503','400','JSON','confirmed invalid'])test(script+' retains initial saved selection after '+failure,async()=>{
    const storage=new Map([[SELECTION_KEY,JSON.stringify(chosen)]]);
    const h=await frontendHarness(script,page,{storage}),req=h.requests[0];
    if(failure==='network')req.reject(Error('Synthetic offline failure'));
    else if(failure==='JSON')req.headers(async()=>{throw Error('Synthetic JSON failure');});
    else req.httpFailure(failure==='503'?503:400,failure==='confirmed invalid'?invalidSelection(chosen):null);
    await settle();assert.equal(h.requests.length,1);
    assert.equal(storage.get(SELECTION_KEY),JSON.stringify(chosen));assert.equal(h.node(total).textContent,'Unavailable');
    assert.match(h.node(error).textContent,failure==='confirmed invalid'?/Choose valid/:/Unable to verify/);
    h.node('retry-load').click();assert.equal(h.requests[1].url,h.requests[0].url);
    await deliver(h,filtered());assert.equal(h.node(error).hidden,true);
  });
  for(const stored of ['{broken','[]','null','["UNPERMITTED-IDENTITY"]','["SYN-CAD-TFSA","SYN-CAD-TFSA"]']){
    test(script+' never expands or sends a corrupt saved selection: '+stored,async()=>{
      const storage=new Map([[SELECTION_KEY,stored]]),h=await frontendHarness(script,page,{storage});
      await settle();assert.equal(h.requests.length,0);assert.equal(storage.get(SELECTION_KEY),stored);
      assert.equal(h.node(total).textContent,'Unavailable');assert.match(h.node(error).textContent,/selection is invalid/);
    });
  }
  test(script+' rejects a valid but unrequested all-account response and retains filtered snapshot',async()=>{
    const storage=new Map([[SELECTION_KEY,JSON.stringify(chosen)]]);
    const h=await frontendHarness(script,page,{storage});await deliver(h,filtered());
    const before=h.node(total).textContent;h.node('retry-load').click();await deliver(h,base);
    assert.equal(h.node(total).textContent,before);assert.equal(h.node(error).hidden,false);
    assert.equal(storage.get(SELECTION_KEY),JSON.stringify(chosen));
  });
}
test('only versioned, request-matched 400 errors confirm invalid account selection',async()=>{
  const good=invalidSelection(chosen);
  await assert.rejects(readJournalResponse({ok:false,status:400,json:async()=>good},{accountIds:chosen}),InvalidAccountSelection);
  for(const [status,data] of [[503,good],[400,{...good,schemaVersion:2}],[400,{...good,requestedAccountIds:['SYN-MISSING']}],
    [400,{...good,synthetic:false}],[400,{...good,code:'JOURNAL_UNAVAILABLE'}],[400,null]]){
    await assert.rejects(readJournalResponse({ok:false,status,json:async()=>data},{accountIds:chosen}),e=>!(e instanceof InvalidAccountSelection));
  }
});
test('server exposes the shared module and machine-readable selection errors without changing security headers',async()=>{
  const server=createAppServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  try{
    const module=await fetch(url+'/journal-response.mjs');assert.equal(module.status,200);
    assert.match(module.headers.get('content-type'),/javascript/);assert.equal(module.headers.get('cache-control'),'no-store');
    assert.match(module.headers.get('content-security-policy'),/connect-src 'self'/);
    const response=await fetch(url+'/api/r1a/state?accounts=SYN-MISSING');assert.equal(response.status,400);
    assert.deepEqual(await response.json(),invalidSelection(['SYN-MISSING']));
    const badQuery=await fetch(url+'/api/r1a/state?unexpected=synthetic');assert.equal(badQuery.status,400);
    assert.equal((await badQuery.json()).code,'INVALID_REQUEST');
    validateJournalResponse(await (await fetch(url+'/api/r1a/state')).json());
  }finally{await new Promise(resolve=>server.close(resolve));}
});
