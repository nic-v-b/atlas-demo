import test from 'node:test';
import assert from 'node:assert/strict';
import {frontendHarness,settle} from './frontend-harness.mjs';
import {getUnifiedSyntheticJournal} from '../backend/r1a-journal.mjs';
import {buildUnifiedSyntheticViews} from '../backend/r1a-unified.mjs';

// Independently calculated golden amounts and one-decimal portfolio percentages.
// Deliberately DO NOT build expected labels from the API payload under test.
// Four-account fictional baseline: CA$20,473 + US$3,096 x 1.35 = CA$24,652.60.
// R1a adds CA$4,548 cash and CA$525 stock value to the R0g baseline.
const baseline={
  vehicle:[
    ['Cash','CA$15,749.60','63.9%'],
    ['ETFs','CA$4,800.00','19.5%'],
    ['Individual stocks','CA$3,843.00','15.6%'],
    ['CAD depositary receipts','CA$260.00','1.1%']
  ],
  strategy:[
    ['Cash','CA$15,749.60','63.9%'],
    ['Global diversified ETF','CA$3,200.00','13.0%'],
    ['Direct US healthcare stock','CA$2,268.00','9.2%'],
    ['Technology-focused ETF','CA$1,600.00','6.5%'],
    ['Direct Canadian financial stock','CA$1,575.00','6.4%'],
    ['Technology-linked CAD receipt','CA$260.00','1.1%']
  ],
  sector:[
    ['Cash','CA$15,749.60','63.9%'],
    ['Health care','CA$2,748.00','11.1%'],
    ['Technology','CA$2,660.00','10.8%'],
    ['Financials','CA$2,215.00','9.0%'],
    ['Consumer','CA$480.00','1.9%'],
    ['Industrials','CA$480.00','1.9%'],
    ['Other sectors','CA$320.00','1.3%']
  ],
  geography:[
    ['Cash','CA$15,749.60','63.9%'],
    ['United States','CA$5,408.00','21.9%'],
    ['Canada','CA$2,295.00','9.3%'],
    ['Other developed markets','CA$880.00','3.6%'],
    ['Emerging markets','CA$320.00','1.3%']
  ]
};
function rows(h){
  return h.node('h-legend').children
    .filter(row=>row.className==='h-exposure-row')
    .map(row=>({
      name:row.children[1].children[0].textContent,
      label:row.children.at(-1).textContent
    }));
}
function checkGoldenRows(h,triples,mode){
  const actual=rows(h);
  assert.ok(triples.length>0,'golden category set must be nonempty');
  assert.equal(actual.length,triples.length,'no missing, extra, or vacuous rows');
  assert.deepEqual(actual,triples.map(([name,money,pct])=>({
    name,label:mode==='money'?money:mode==='percent'?pct:money+' · '+pct
  })));
}

test('four dimensions each render exact golden amounts, weights and both modes',async()=>{
  const h=await frontendHarness('holdings.js','holdings.html');
  assert.equal(h.requests.length,1);
  const result=buildUnifiedSyntheticViews(getUnifiedSyntheticJournal());
  h.requests[0].resolve(result);await settle();await settle();
  assert.equal(h.node('cad-equivalent').textContent,'CA$24,652.60');
  const originalFilters=h.buttons().map(b=>b.getAttribute('aria-pressed'));
  for(const [dimension,triples] of Object.entries(baseline)){
    h.node('tab-'+dimension).click();
    assert.equal(h.node('tab-'+dimension).getAttribute('aria-selected'),'true');
    for(const mode of ['money','percent','both']){
      h.node('mode-'+mode).click();
      assert.equal(h.node('mode-'+mode).getAttribute('aria-pressed'),'true');
      checkGoldenRows(h,triples,mode);
    }
  }
  assert.equal(h.node('cad-equivalent').textContent,'CA$24,652.60');
  assert.deepEqual(h.buttons().map(b=>b.getAttribute('aria-pressed')),originalFilters);
  assert.equal(h.requests.length,1,'format changes must never fetch or recalculate');
});

test('amount mode persists across account changes and shows correct selected totals',async()=>{
  const h=await frontendHarness('holdings.js','holdings.html');
  h.requests[0].resolve(buildUnifiedSyntheticViews(getUnifiedSyntheticJournal()));
  await settle();await settle();
  h.node('mode-money').click();
  h.buttons()[0].click(); // remove the CAD taxable account
  h.buttons()[3].click(); // remove the second taxable account
  assert.equal(h.requests.length,3);
  h.requests[2].resolve(buildUnifiedSyntheticViews(getUnifiedSyntheticJournal(),{
    accountIds:['SYN-CAD-TFSA','SYN-USD-TEST']
  }));
  await settle();await settle();
  assert.equal(h.node('mode-money').getAttribute('aria-pressed'),'true');
  assert.equal(h.node('cad-equivalent').textContent,'CA$9,289.60');
  checkGoldenRows(h,[
    ['Cash','CA$5,161.60','55.6%'],
    ['Individual stocks','CA$2,268.00','24.4%'],
    ['ETFs','CA$1,600.00','17.2%'],
    ['CAD depositary receipts','CA$260.00','2.8%']
  ],'money');
  h.node('mode-percent').click();
  checkGoldenRows(h,[
    ['Cash','CA$5,161.60','55.6%'],
    ['Individual stocks','CA$2,268.00','24.4%'],
    ['ETFs','CA$1,600.00','17.2%'],
    ['CAD depositary receipts','CA$260.00','2.8%']
  ],'percent');
});

test('missing FX with native balances never displays stale combined monetary labels',async()=>{
  const fixture=getUnifiedSyntheticJournal();
  delete fixture.valuationFx;
  const view=buildUnifiedSyntheticViews(fixture);
  assert.equal(view.holdings.valuationState,'missing-fx');
  const h=await frontendHarness('holdings.js','holdings.html');
  h.requests[0].resolve(view);
  await settle();await settle();
  assert.equal(h.node('cad-equivalent').textContent,'Unavailable');
  assert.equal(h.node('cad-total').textContent,'CA$20,473.00');
  assert.equal(h.node('usd-total').textContent,'US$3,096.00');
  for(const dimension of ['vehicle','strategy','sector','geography']){
    h.node('tab-'+dimension).click();
    for(const mode of ['money','percent','both']){
      h.node('mode-'+mode).click();
      assert.equal(rows(h).length,0,'no invalid cross-currency composition labels');
      assert.match(h.node('h-legend').textContent,/date-matched CAD valuation rate/);
    }
  }
});

test('empty portfolio never invents amount or percent composition rows',async()=>{
  const fixture=getUnifiedSyntheticJournal();
  fixture.accounts.push({id:'SYN-EMPTY',ownerId:'SYN-OWNER-EMPTY',label:'Fictional empty account',type:'tfsa',currency:'CAD'});
  const view=buildUnifiedSyntheticViews(fixture,{accountIds:['SYN-EMPTY']});
  assert.equal(view.holdings.valuationState,'empty');
  const h=await frontendHarness('holdings.js','holdings.html',{storage:new Map([['atlas-synthetic-account-selection-v1',JSON.stringify(['SYN-EMPTY'])]])});
  h.requests[0].resolve(view);
  await settle();await settle();
  assert.equal(h.node('cad-equivalent').textContent,'CA$0.00');
  for(const dimension of ['vehicle','strategy','sector','geography']){
    h.node('tab-'+dimension).click();
    for(const mode of ['money','percent','both']){
      h.node('mode-'+mode).click();
      assert.equal(rows(h).length,0,'empty selection cannot have composition labels');
      assert.match(h.node('h-legend').textContent,/selection is empty/);
    }
  }
});
