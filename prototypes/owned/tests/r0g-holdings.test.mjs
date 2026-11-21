import test from 'node:test';
import assert from 'node:assert/strict';
import {getHoldingsFixture} from '../backend/holdings-fixture.mjs';
import {calculateSyntheticHoldings} from '../backend/holdings.mjs';
import {buildSyntheticTaxLabView} from '../backend/tax-lab-view.mjs';
import {taxablePoolingFixture} from '../accounting/r0f-fixtures.mjs';
const model=(f=getHoldingsFixture(),selected=null)=>
  calculateSyntheticHoldings(f,{accountIds:selected});
const clone=x=>structuredClone(x);

function datedFixture(date){
  const f=getHoldingsFixture();
  f.asOf=date;
  f.quotes.forEach(q=>{q.asOf=date;});
  f.securities.forEach(s=>{s.analysis.asOf=date;});
  f.valuationFx.asOf=date;f.exampleSectorPolicy.asOf=date;
  f.events.forEach((e,i)=>{e.date=date.slice(0,4)+'-01-01';e.seq=i+1;});
  return f;
}
for(const date of ['2026-11-31','2026-99-99','2025-02-29','1900-02-29','2026-04-31','2026-00-01','2026-01-00']){
  test('reject impossible snapshot date and matching quote/FX/classification/policy: '+date,()=>{
    assert.throws(()=>model(datedFixture(date)),/Invalid ISO calendar date/);
  });
}
for(const date of ['2024-02-29','2000-02-29','2025-02-28','2026-04-30','2026-11-30','2026-12-31']){
  test('accept real snapshot calendar boundary: '+date,()=>{
    const d=model(datedFixture(date));
    assert.equal(d.asOf,date);assert.equal(d.fx.asOf,date);
    assert.equal(d.exposure.asOf,date);
    assert.equal(d.exposure.exampleSectorComparison.asOf,date);
    assert.ok(d.positions.every(p=>p.quoteAsOf===date));
    assert.equal(d.cadEquivalent,'19579.60');
  });
}
test('event dates use the same strict calendar validation as snapshots',()=>{
  for(const date of ['2026-11-31','2026-99-99','2025-02-29']){
    const f=getHoldingsFixture();f.events[0].date=date;
    assert.throws(()=>model(f),/Invalid ISO calendar date/);
  }
  const f=datedFixture('2024-02-29');
  f.events.at(-1).date='2024-02-29';
  assert.equal(model(f).asOf,'2024-02-29');
});
test('valid snapshot cannot borrow impossible quote, FX, classification or example-policy dates',()=>{
  for(const field of ['quote','fx','classification','policy']){
    const f=getHoldingsFixture();
    const target={quote:f.quotes[0],fx:f.valuationFx,classification:f.securities[0].analysis,policy:f.exampleSectorPolicy}[field];
    target.asOf='2026-11-31';
    assert.throws(()=>model(f),/stale|Stale|date mismatch|dated to the valuation/);
  }
});
test('reject USD Canadian CDR even with matching quote, transaction and funded USD wallet',()=>{
  const f=getHoldingsFixture(),s=f.securities.find(s=>s.kind==='cdr');
  s.currency='USD';
  f.quotes.find(q=>q.securityId===s.id).currency='USD';
  const buy=f.events.find(e=>e.securityId===s.id);
  buy.currency='USD';buy.accountId='SYN-USD-TEST';
  assert.throws(()=>model(f),/Canadian CDR.*CAD/);
});
test('valid CAD CDR and ordinary USD equity preserve distinct native cash wallets',()=>{
  const f=getHoldingsFixture();
  f.events.push({id:'SYN-CDR-EXCHANGE',date:'2026-04-01',seq:1,accountId:'SYN-USD-TEST',
    type:'exchange',from:'USD',to:'CAD',amount:'100',rate:'1.40',fee:'0'});
  f.events.push({id:'SYN-CDR-BUY',date:'2026-04-01',seq:2,accountId:'SYN-USD-TEST',
    type:'buy',securityId:'SYN-CDR-1',currency:'CAD',quantity:'1',unitPrice:'50',fee:'0'});
  const d=model(f,['SYN-USD-TEST']);
  assert.equal(d.currencyTotals.CAD.cash,'90.00');
  assert.equal(d.currencyTotals.USD.cash,'1316.00');
  assert.equal(d.positions.find(p=>p.kind==='cdr').currency,'CAD');
  assert.equal(d.positions.find(p=>p.kind==='equity').currency,'USD');
});
for(const withFx of [true,false]){
  test('zero-event portfolio is explicitly empty '+(withFx?'with':'without')+' FX',()=>{
    const f=getHoldingsFixture();f.events=[];
    if(!withFx)delete f.valuationFx;
    const d=model(f,['SYN-CAD-TAX','SYN-USD-TEST']);
    assert.equal(d.valuationState,'empty');
    assert.equal(d.cadEquivalent,'0.00');
    assert.equal(d.positions.length,0);assert.equal(d.accountCount,2);
    for(const c of ['CAD','USD'])assert.deepEqual(d.currencyTotals[c],{cash:'0.00',positionValue:'0.00',total:'0.00'});
    assert.equal(d.takeaway.state,'empty');
    assert.doesNotMatch(JSON.stringify(d.takeaway),/FX|conversion|unavailable/);
    assert.equal(d.exposure,null);assert.equal(d.allocation,null);
  });
}
test('nonempty cross-currency selection still reports genuine missing FX',()=>{
  const f=getHoldingsFixture();delete f.valuationFx;
  const d=model(f);
  assert.equal(d.valuationState,'missing-fx');assert.equal(d.cadEquivalent,null);
  assert.match(d.takeaway.text,/FX rate/);
  assert.equal(d.currencyTotals.USD.total,'3096.00');
  assert.equal(d.currencyTotals.CAD.total,'15400.00');
  const cadOnly=model(f,['SYN-CAD-TAX']);
  assert.equal(cadOnly.valuationState,'valued');assert.equal(cadOnly.cadEquivalent,'10290.00');
});
test('three fictional accounts reconcile native cash and positions by currency without direct addition',()=>{
  const r=model();
  assert.deepEqual(r.currencyTotals,{
    CAD:{cash:'9290.00',positionValue:'6110.00',total:'15400.00'},
    USD:{cash:'1416.00',positionValue:'1680.00',total:'3096.00'}
  });
  assert.equal(r.cadEquivalent,'19579.60');
  assert.equal(r.positions.length,6);
  assert.equal(r.accountCount,3);
  assert.equal(r.taxReady,false);
});
test('CAD taxable selection matches its own cash and positions, excluding TFSA',()=>{
  const r=model(getHoldingsFixture(),['SYN-CAD-TAX']);
  assert.equal(r.currencyTotals.CAD.cash,'6040.00');
  assert.equal(r.currencyTotals.CAD.positionValue,'4250.00');
  assert.equal(r.currencyTotals.CAD.total,'10290.00');
  assert.equal(r.positions.length,3);
  assert.equal(r.positions.every(p=>p.accountId==='SYN-CAD-TAX'),true);
  assert.equal(r.cadEquivalent,'10290.00');
});
test('TFSA selection is isolated and ETF units do not join taxable account custody',()=>{
  const r=model(getHoldingsFixture(),['SYN-CAD-TFSA']);
  assert.equal(r.currencyTotals.CAD.total,'5110.00');
  assert.equal(r.currencyTotals.USD.total,'0.00');
  assert.deepEqual(r.positions.map(p=>p.quantity),['10.0000','5.0000']);
});
test('USD-native selection shows USD cash and USD native book cost, with explicit CAD equivalent',()=>{
  const r=model(getHoldingsFixture(),['SYN-USD-TEST']);
  assert.equal(r.currencyTotals.USD.cash,'1416.00');
  assert.equal(r.currencyTotals.USD.positionValue,'1680.00');
  assert.equal(r.positions[0].bookValueNative,'1600.00');
  assert.equal(r.positions[0].unrealizedNative,'80.00');
  assert.equal(r.positions[0].incomeNative,'16.00');
  assert.equal(r.cadEquivalent,'4179.60');
});
test('multiple account selection adds like currency wallets, never silently adds USD to CAD',()=>{
  const r=model(getHoldingsFixture(),['SYN-CAD-TAX','SYN-USD-TEST']);
  assert.equal(r.currencyTotals.CAD.total,'10290.00');
  assert.equal(r.currencyTotals.USD.total,'3096.00');
  assert.equal(r.cadEquivalent,'14469.60');
  assert.equal(r.positions.length,4);
});
test('without dated valuation FX, mixed-currency combined total and allocation fail closed',()=>{
  const f=getHoldingsFixture();delete f.valuationFx;
  const r=model(f);
  assert.equal(r.cadEquivalent,null);
  assert.equal(r.allocation,null);
  assert.equal(r.takeaway.state,'unavailable');
  assert.equal(r.currencyTotals.CAD.total,'15400.00');
  assert.equal(r.currencyTotals.USD.total,'3096.00');
});
test('same-date USD-to-CAD FX changes only comparable valuation, not native wallets or quantity',()=>{
  const f=getHoldingsFixture();
  f.valuationFx.rate='1.50';
  const r=model(f);
  assert.equal(r.cadEquivalent,'20044.00');
  assert.equal(r.currencyTotals.USD.cash,'1416.00');
  assert.equal(r.positions.find(p=>p.currency==='USD').quantity,'8.0000');
});
test('dated valuation FX direction is required, stale FX or mislabeled native quote fails',()=>{
  const f=getHoldingsFixture();f.valuationFx.asOf='2026-10-31';
  assert.throws(()=>model(f),/Stale\/ambiguous valuation FX/);
  const g=getHoldingsFixture();g.valuationFx.from='CAD';
  assert.throws(()=>model(g),/Stale\/ambiguous valuation FX/);
  const h=getHoldingsFixture();h.quotes[4].currency='CAD';
  assert.throws(()=>model(h),/Missing or stale native quote metadata/);
});
test('missing quote for an open USD or CAD position is rejected, not priced at zero',()=>{
  const f=getHoldingsFixture();f.quotes=f.quotes.filter(q=>q.securityId!=='SYN-USD-1');
  assert.throws(()=>model(f),/Missing quote for open position/);
  const g=getHoldingsFixture();g.quotes[0].asOf='2026-09-01';
  assert.throws(()=>model(g),/Missing or stale native quote metadata/);
});
test('synthetic account IDs are unique and required for nonempty filtering',()=>{
  const f=getHoldingsFixture();
  assert.throws(()=>model(f,['SYN-UNKNOWN']),/Unknown, empty or duplicate account/);
  assert.throws(()=>model(f,[]),/Unknown, empty or duplicate account/);
  assert.throws(()=>model(f,['SYN-CAD-TAX','SYN-CAD-TAX']),/Unknown, empty or duplicate account/);
});
test('only explicit source-wallet FX exchange changes pockets; fee is paid in source currency',()=>{
  const f=getHoldingsFixture();
  f.events.push({id:'SYN-J11',date:'2026-04-01',seq:1,accountId:'SYN-USD-TEST',
    type:'exchange',from:'USD',to:'CAD',amount:'100',rate:'1.40',fee:'2'});
  const r=model(f,['SYN-USD-TEST']);
  assert.equal(r.currencyTotals.USD.cash,'1314.00');
  assert.equal(r.currencyTotals.CAD.cash,'140.00');
  assert.equal(r.currencyTotals.USD.positionValue,'1680.00');
  assert.equal(r.cadEquivalent,'4181.90');
});
test('purchase in wrong currency cannot implicitly convert another cash pocket',()=>{
  const f=getHoldingsFixture();
  f.events.push({id:'SYN-J11',date:'2026-04-01',seq:1,accountId:'SYN-CAD-TAX',
    type:'buy',currency:'USD',securityId:'SYN-USD-1',quantity:'1',unitPrice:'200',fee:'0'});
  assert.throws(()=>model(f),/Insufficient USD cash/);
});
test('USD sale decreases native basis proportionately and credits USD cash, with zero CAD trade',()=>{
  const f=getHoldingsFixture();
  f.events.push({id:'SYN-J11',date:'2026-04-01',seq:1,accountId:'SYN-USD-TEST',
    type:'sell',securityId:'SYN-USD-1',currency:'USD',quantity:'2',unitPrice:'220',fee:'2'});
  const r=model(f,['SYN-USD-TEST']);
  assert.equal(r.currencyTotals.USD.cash,'1854.00');
  assert.equal(r.currencyTotals.USD.positionValue,'1260.00');
  assert.equal(r.positions[0].quantity,'6.0000');
  assert.equal(r.positions[0].bookValueNative,'1200.00');
  assert.equal(r.positions[0].unrealizedNative,'60.00');
});
test('strict event metadata rejects unknown fee currencies and unsupported flows',()=>{
  const f=getHoldingsFixture();f.events[3].feeCurrency='USD';
  assert.throws(()=>model(f),/Unsupported transaction metadata/);
  const g=getHoldingsFixture();g.events[3].type='roc';
  assert.throws(()=>model(g),/Unsupported event type/);
});
test('oversell, nonpositive trade or unsupported synthetic status fails closed',()=>{
  const f=getHoldingsFixture();f.events[4].quantity='0';
  assert.throws(()=>model(f),/Units must be positive/);
  const g=getHoldingsFixture();g.events.push({id:'SYN-J11',date:'2026-04-01',seq:1,
    accountId:'SYN-CAD-TAX',type:'sell',securityId:'SYN-ETF-1',currency:'CAD',
    quantity:'21',unitPrice:'160',fee:'0'});
  assert.throws(()=>model(g),/Cannot sell units not owned/);
  const h=getHoldingsFixture();h.synthetic=false;
  assert.throws(()=>model(h),/Only synthetic Holdings fixtures/);
});
test('journal arithmetic is decimal exact even for 0.10 and 0.20 deposits',()=>{
  const f=getHoldingsFixture();
  f.events.push({id:'SYN-J11',date:'2026-04-01',seq:1,accountId:'SYN-CAD-TAX',
    type:'deposit',currency:'CAD',amount:'0.10'});
  f.events.push({id:'SYN-J12',date:'2026-04-02',seq:1,accountId:'SYN-CAD-TAX',
    type:'deposit',currency:'CAD',amount:'0.20'});
  assert.equal(model(f,['SYN-CAD-TAX']).currencyTotals.CAD.cash,'6040.30');
});
test('unrecognized identifiers and private extra fields never enter allowlisted client projection',()=>{
  const f=getHoldingsFixture();f.accounts[0].privateAccountNumber='DONT_EMIT_CANARY_7788';
  f.events[0].secretMemo='INVALID_NON_SYNTHETIC';
  assert.throws(()=>model(f),/Unsupported transaction metadata/);
  delete f.events[0].secretMemo;
  const raw=JSON.stringify(model(f));
  assert.equal(raw.includes('DONT_EMIT_CANARY_7788'),false);
  assert.equal(raw.includes('PRIVATE'),false);
});
test('dynamic Tax Lab calculations agree with R0f synthetic oracle and remaining pool',()=>{
  const d=buildSyntheticTaxLabView();
  assert.deepEqual(d.before,{units:'20',cost:'CA$600.00',average:'CA$30.00'});
  assert.deepEqual(d.after,{units:'15',cost:'CA$450.00',average:'CA$30.00'});
  assert.equal(d.sale.preliminaryGain,'CA$0.00');
  assert.equal(d.sale.accountOnlyGain,'CA$50.00');
  assert.equal(d.sale.allocatedAcb,'CA$150.00');
  assert.equal(d.taxReady,false);
});
test('Tax Lab is genuinely calculated: modifying invented second buy changes ACB and gain',()=>{
  const f=clone(taxablePoolingFixture);f.events[1].unitPrice='50';
  const d=buildSyntheticTaxLabView(f);
  assert.equal(d.before.cost,'CA$700.00');
  assert.equal(d.before.average,'CA$35.00');
  assert.equal(d.sale.preliminaryGain,'-CA$25.00');
  assert.equal(d.after.cost,'CA$525.00');
  assert.equal(d.sale.accountOnlyGain,'CA$50.00');
});
test('Tax Lab refuses an unsuitable synthetic journal rather than displaying stale numbers',()=>{
  const f=clone(taxablePoolingFixture);f.events.pop();
  assert.throws(()=>buildSyntheticTaxLabView(f),/requires exactly two CAD purchases/);
});
test('Tax Lab does not emit unrecognized extra owner financial metadata',()=>{
  const f=clone(taxablePoolingFixture);
  f.accounts[0].accountStatementNumber='PRIVATE_TAX_LAB_CANARY_876';
  const data=JSON.stringify(buildSyntheticTaxLabView(f));
  assert.equal(data.includes('PRIVATE_TAX_LAB_CANARY_876'),false);
});


const exposure=(f=getHoldingsFixture(),selection=null)=>model(f,selection).exposure;
const row=(view,dimension,key)=>view.dimensions[dimension].find(x=>x.key===key);
test('ETF subcategories distinguish global diversified and technology-focused funds without changing total',()=>{
  const r=model(),e=r.exposure;
  assert.equal(r.cadEquivalent,'19579.60');
  assert.equal(r.currencyTotals.CAD.total,'15400.00');
  assert.equal(r.currencyTotals.USD.total,'3096.00');
  assert.deepEqual(e.etfMix.map(x=>[x.key,x.valueCad,x.percentOfEtfs,x.percentOfPortfolio]),[
    ['global-diversified-etf','3200.00',66.7,16.3],
    ['technology-sector-etf','1600.00',33.3,8.2]
  ]);
  assert.equal(e.etfValueCad,'4800.00');
  assert.equal(row(e,'vehicle','etf').percentOfPortfolio,24.5);
});
test('technology sector look-through includes both fictional ETF exposures and direct CAD receipt',()=>{
  const e=exposure();
  assert.deepEqual(row(e,'sector','technology'),{
    key:'technology',label:'Technology',valueCad:'2660.00',
    percentOfPortfolio:13.6,percentOfInvested:31.7
  });
  assert.equal(row(e,'sector','financials').valueCad,'1690.00');
  assert.equal(row(e,'sector','healthcare').valueCad,'2748.00');
  assert.equal(row(e,'sector','cash').valueCad,'11201.60');
});
test('geographical look-through distinguishes US, Canada, other developed and emerging',()=>{
  const e=exposure();
  assert.equal(row(e,'geography','us').valueCad,'5408.00');
  assert.equal(row(e,'geography','canada').valueCad,'1770.00');
  assert.equal(row(e,'geography','developed').valueCad,'880.00');
  assert.equal(row(e,'geography','emerging').valueCad,'320.00');
  assert.equal(e.coverage.sectorPctOfInvested,100);
  assert.equal(e.coverage.geographyPctOfInvested,100);
});
test('every composition dimension reconciles to CAD-equivalent portfolio total independently',()=>{
  const e=exposure(),cents=s=>BigInt(s.replace('.',''));
  for(const dimension of ['vehicle','strategy','sector','geography']){
    const total=e.dimensions[dimension].reduce((n,x)=>n+cents(x.valueCad),0n);
    assert.equal(total,1957960n,dimension);
    assert.ok(e.dimensions[dimension].every(x=>x.percentOfPortfolio>=0));
  }
  assert.equal(e.etfMix.reduce((n,x)=>n+cents(x.valueCad),0n),480000n);
});
test('account selection recomputes tech and global ETF mix, sector exposure and cash',()=>{
  const e=exposure(getHoldingsFixture(),['SYN-CAD-TAX']);
  assert.deepEqual(e.etfMix.map(x=>x.percentOfEtfs),[50,50]);
  assert.equal(e.etfValueCad,'3200.00');
  assert.equal(row(e,'sector','technology').valueCad,'2000.00');
  assert.equal(row(e,'sector','financials').valueCad,'1370.00');
  assert.equal(row(e,'sector','cash').valueCad,'6040.00');
  assert.equal(e.investedValueCad,'4250.00');
});
test('TFSA-only view excludes taxable tech ETF and keeps CAD receipt look-through',()=>{
  const e=exposure(getHoldingsFixture(),['SYN-CAD-TFSA']);
  assert.equal(e.etfMix.length,1);
  assert.equal(e.etfMix[0].key,'global-diversified-etf');
  assert.equal(e.etfMix[0].percentOfEtfs,100);
  assert.equal(e.etfValueCad,'1600.00');
  assert.equal(row(e,'sector','technology').valueCad,'660.00');
  assert.equal(row(e,'geography','us').valueCad,'1060.00');
});
test('USD-only view has no ETFs; healthcare and US geography are 100% of invested value',()=>{
  const e=exposure(getHoldingsFixture(),['SYN-USD-TEST']);
  assert.equal(e.etfMix.length,0);
  assert.equal(row(e,'sector','healthcare').percentOfInvested,100);
  assert.equal(row(e,'geography','us').percentOfInvested,100);
  assert.equal(row(e,'sector','technology'),undefined);
  assert.equal(e.diagnostics.cashPctOfPortfolio,45.7);
});
test('missing dated FX removes ALL combined composition dimensions instead of inventing weights',()=>{
  const f=getHoldingsFixture();
  delete f.valuationFx;
  const r=model(f);
  assert.equal(r.cadEquivalent,null);
  assert.equal(r.allocation,null);
  assert.equal(r.exposure,null);
  assert.equal(r.currencyTotals.USD.total,'3096.00');
});
test('missing classification is shown as unknown, never silently considered technology or US',()=>{
  const f=getHoldingsFixture();
  delete f.securities.find(s=>s.id==='SYN-ETF-TECH').analysis;
  const e=exposure(f);
  assert.equal(row(e,'sector','unclassified').valueCad,'1600.00');
  assert.equal(row(e,'geography','unclassified').valueCad,'1600.00');
  assert.equal(row(e,'strategy','unclassified').valueCad,'1600.00');
  assert.equal(e.coverage.sectorPctOfInvested,80.9);
});
test('invalid, stale or incomplete ETF classifications fail closed instead of fabricating breakdowns',()=>{
  const f=getHoldingsFixture();
  f.securities[0].analysis.sectors[0].weight='24.9';
  assert.throws(()=>model(f),/sum to exactly 100%/);
  const g=getHoldingsFixture();
  g.securities[0].analysis.asOf='2025-01-01';
  assert.throws(()=>model(g),/date mismatch|dated to the valuation/);
  const h=getHoldingsFixture();
  h.securities[0].analysis.geographies[0].key='not-a-real-region';
  assert.throws(()=>model(h),/Invalid or duplicate exposure category/);
  const i=getHoldingsFixture();
  i.securities[0].analysis.strategy='made-up-portfolio-strategy';
  assert.throws(()=>model(i),/Unsupported synthetic investment strategy/);
});


const policyRow=(r,key)=>r.exposure?.exampleSectorComparison?.rows.find(row=>row.key===key);
test('fictional target policy is labeled, dated, and uses invested assets rather than portfolio including cash',()=>{
  const r=model();
  const p=r.exposure.exampleSectorComparison;
  assert.equal(p.synthetic,true);
  assert.equal(p.asOf,'2026-11-01');
  assert.match(p.source,/Invented targets/);
  assert.match(p.basis,/INVESTED holdings/);
  assert.deepEqual(policyRow(r,'healthcare'),{
    key:'healthcare',label:'Health care',actualPct:32.8,targetPct:20,
    deltaPp:12.8,valueCad:'2748.00'
  });
  assert.equal(policyRow(r,'technology').actualPct,31.7);
  assert.equal(policyRow(r,'technology').targetPct,25);
  assert.equal(policyRow(r,'technology').deltaPp,6.7);
  assert.equal(policyRow(r,'financials').deltaPp,0.2);
});
test('example target gaps report below without calling that sector an investment recommendation',()=>{
  const r=model(),p=r.exposure.exampleSectorComparison;
  assert.equal(policyRow(r,'other').deltaPp,-9.2);
  assert.equal(policyRow(r,'industrials').deltaPp,-6.3);
  assert.equal(policyRow(r,'consumer').deltaPp,-4.3);
  assert.equal(p.rows.length,6);
  assert.ok(p.rows.every(row=>!Object.hasOwn(row,'recommendation')));
  assert.match(p.limitations,/does not imply a sector should be bought/i);
});
test('comparing current and example targets never changes native cash, account custody or CAD/USD values',()=>{
  const baseline=getHoldingsFixture(),none=clone(baseline);
  delete none.exampleSectorPolicy;
  const withPolicy=model(baseline),withoutPolicy=model(none);
  assert.equal(withoutPolicy.exposure.exampleSectorComparison,null);
  assert.equal(withPolicy.cadEquivalent,withoutPolicy.cadEquivalent);
  assert.deepEqual(withPolicy.currencyTotals,withoutPolicy.currencyTotals);
  assert.deepEqual(withPolicy.positions,withoutPolicy.positions);
  assert.deepEqual(withPolicy.perAccount,withoutPolicy.perAccount);
});
test('target-gap comparison updates when selecting one fictional account and excludes unrelated custody',()=>{
  const r=model(getHoldingsFixture(),['SYN-USD-TEST']);
  assert.equal(r.currencyTotals.CAD.total,'0.00');
  assert.equal(r.currencyTotals.USD.total,'3096.00');
  assert.equal(policyRow(r,'healthcare').actualPct,100);
  assert.equal(policyRow(r,'healthcare').targetPct,20);
  assert.equal(policyRow(r,'healthcare').deltaPp,80);
  assert.equal(policyRow(r,'technology').actualPct,0);
  assert.equal(policyRow(r,'technology').deltaPp,-25);
});
test('example policy is not applied without full classification or when FX is missing',()=>{
  const f=getHoldingsFixture();
  delete f.securities.find(s=>s.id==='SYN-ETF-TECH').analysis;
  assert.equal(model(f).exposure.exampleSectorComparison,null);
  const g=getHoldingsFixture();
  delete g.valuationFx;
  assert.equal(model(g).exposure,null);
});
test('fictional targets must sum exactly to 100, be unique, and carry correct as-of date',()=>{
  const f=getHoldingsFixture();
  f.exampleSectorPolicy.targets[0].weight='24.9';
  assert.throws(()=>model(f),/targets must sum to exactly 100/);
  const g=getHoldingsFixture();
  g.exampleSectorPolicy.targets[1].key='technology';
  assert.throws(()=>model(g),/Unknown or duplicate demo target/);
  const h=getHoldingsFixture();
  h.exampleSectorPolicy.asOf='2026-10-31';
  assert.throws(()=>model(h),/Invalid or stale fictional sector policy/);
  const i=getHoldingsFixture();
  i.exampleSectorPolicy.synthetic=false;
  assert.throws(()=>model(i),/Invalid or stale fictional sector policy/);
});


test('cash-only fictional portfolios retain totals without inventing invested-sector coverage',()=>{
  const f=getHoldingsFixture();
  f.events=f.events.filter(e=>e.type==='deposit');
  const r=model(f);
  assert.equal(r.positions.length,0);
  assert.equal(r.cadEquivalent,'19050.00');
  assert.equal(r.exposure.investedValueCad,'0.00');
  assert.equal(r.exposure.coverage.sectorPctOfInvested,null);
  assert.equal(r.exposure.coverage.geographyPctOfInvested,null);
  assert.equal(r.exposure.exampleSectorComparison,null);
  assert.equal(r.currencyTotals.CAD.cash,'15000.00');
  assert.equal(r.currencyTotals.USD.cash,'3000.00');
});
test('FX provenance preserves all validated rate decimals rather than formatting as money',()=>{
  const f=getHoldingsFixture();
  f.valuationFx.rate='1.345678';
  const r=model(f,['SYN-USD-TEST']);
  assert.equal(r.fx.rate,'1.345678');
  assert.equal(r.cadEquivalent,'4166.22');
  assert.equal(r.currencyTotals.USD.total,'3096.00');
  assert.equal(r.positions[0].quantity,'8.0000');
});
test('educational Tax Lab preserves fractional purchase units and remaining custody',()=>{
  const f=clone(taxablePoolingFixture);
  f.events.find(e=>e.id==='SYN-E1').quantity='10.25';
  const d=buildSyntheticTaxLabView(f);
  assert.equal(d.before.units,'20.25');
  assert.equal(d.after.units,'15.25');
  assert.match(d.accounts[0].detail,/^10\.25 shares/);
  assert.equal(d.sale.quantity,'5');
});
test('educational Tax Lab average derives from oracle, not rounded remaining cost',()=>{
  const f=clone(taxablePoolingFixture);
  f.events.find(e=>e.id==='SYN-E1').quantity='0.001';
  f.events.find(e=>e.id==='SYN-E2').quantity='0.001';
  f.events.find(e=>e.id==='SYN-E5').quantity='0.000999';
  const d=buildSyntheticTaxLabView(f);
  assert.equal(d.before.units,'0.002');
  assert.equal(d.after.units,'0.001001');
  assert.equal(d.after.average,'CA$30.00');
  assert.equal(d.accounts[1].detail.startsWith('0.001 shares'),true);
});
test('Tax Lab example formulas explicitly deduct sell commission when present',()=>{
  const f=clone(taxablePoolingFixture);
  f.events.find(e=>e.id==='SYN-E5').fee='2';
  const d=buildSyntheticTaxLabView(f);
  assert.equal(d.sale.accountOnlyGain,'CA$48.00');
  assert.equal(d.sale.preliminaryGain,'-CA$2.00');
  assert.match(d.sale.accountOnlyFormula,/− CA\$2\.00 selling fee/);
  assert.match(d.sale.pooledFormula,/− CA\$2\.00 selling fee/);
});
test('Tax Lab sale source reflects B and its held alias, not a hardcoded A',()=>{
  const f=clone(taxablePoolingFixture),sale=f.events.find(e=>e.id==='SYN-E5');
  sale.accountId='SYN-TAX-B';
  sale.securityId='SYN-SHARE-ALIAS';
  const d=buildSyntheticTaxLabView(f);
  assert.equal(d.sale.accountLetter,'B');
  assert.equal(d.timeline.at(-1).title,'Sell from Account B');
  assert.equal(d.sale.preliminaryGain,'CA$0.00');
});


test('positive sub-cent CAD-equivalent cash remains in every exact exposure dimension',()=>{
  const f=getHoldingsFixture();
  f.events=f.events.filter(e=>e.id==='SYN-J3');
  f.events[0].amount='0.01';
  f.valuationFx.rate='0.4'; // USD 0.01 = CAD 0.004, below 0.005
  const r=model(f,['SYN-USD-TEST']);
  assert.equal(r.currencyTotals.USD.cash,'0.01');
  assert.equal(r.cadEquivalent,'0.00'); // currency display precision, not zero economic value
  assert.equal(r.positions.length,0);
  assert.equal(r.exposure.investedValueCad,'0.00');
  for(const name of ['vehicle','strategy','sector','geography']){
    assert.equal(r.exposure.dimensions[name].length,1);
    assert.equal(r.exposure.dimensions[name][0].key,'cash');
    assert.equal(r.exposure.dimensions[name][0].percentOfPortfolio,100);
  }
  assert.equal(r.exposure.coverage.sectorPctOfInvested,null);
  assert.equal(r.exposure.exampleSectorComparison,null);
  assert.equal(r.takeaway.state,'review');
});
test('Tax Lab remaining average rounds directly from exact fractional cost, never via oracle 4dp',()=>{
  const f=clone(taxablePoolingFixture);
  const first=f.events.find(e=>e.id==='SYN-E1');
  const second=f.events.find(e=>e.id==='SYN-E2');
  const sale=f.events.find(e=>e.id==='SYN-E5');
  first.quantity='101';first.unitPrice='30.00';
  second.quantity='99';second.unitPrice='30.01';
  sale.quantity='5';sale.unitPrice='31.00';
  const d=buildSyntheticTaxLabView(f);
  assert.equal(d.before.units,'200');
  assert.equal(d.after.units,'195');
  assert.equal(d.before.average,'CA$30.00');
  assert.equal(d.after.average,'CA$30.00');
  assert.equal(d.sale.quantity,'5');
});
