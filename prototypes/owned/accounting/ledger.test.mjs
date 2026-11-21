import test from 'node:test';
import assert from 'node:assert/strict';
import { Q } from './rational.mjs';
import { calculateSyntheticLedger } from './ledger.mjs';
import { goldSyntheticFixture } from './fixtures.mjs';
const clone = x => structuredClone(x);
const result = calculateSyntheticLedger(goldSyntheticFixture);
const acct = id => result.accounts.find(a=>a.id===id);
const pos = (id,s)=>acct(id).positions.find(p=>p.securityId===s);
test('exact arithmetic does not use binary floating point',()=>{
  assert.equal(Q.of('0.1').add(Q.of('0.2')).fixed(2),'0.30');
  assert.equal(Q.of('1.005').fixed(2),'1.01');
});
test('taxable weighted-average cost after buys, ROC, sale, DRIP and notional distribution',()=>{
  const p=pos('SYN-TAXABLE','SYN-FUND-FT5');
  assert.equal(p.quantity,'16.6000');assert.equal(p.costCad,'402.00');assert.equal(p.realizedCad,'62.00');
  assert.equal(p.incomeCad,'46.00');assert.equal(p.marketValueCad,'581.00');assert.equal(p.unrealizedCad,'179.00');
});
test('fund ROC is cash returned and basis reduction, not income',()=>{
  let without=clone(goldSyntheticFixture);without.events=without.events.filter(e=>e.id!=='E06');
  const a=calculateSyntheticLedger(without).accounts.find(a=>a.id==='SYN-TAXABLE');
  const p=a.positions.find(p=>p.securityId==='SYN-FUND-FT5');
  assert.equal(p.incomeCad,'46.00');
  assert.ok(Number(p.costCad)>Number(pos('SYN-TAXABLE','SYN-FUND-FT5').costCad));
});
test('USD trade uses acquisition FX; USD valuation uses as-of FX',()=>{
  const p=pos('SYN-TAXABLE','SYN-US-EQUITY');
  assert.equal(p.quantity,'2.0000');assert.equal(p.costCad,'262.60');assert.equal(p.marketValueCad,'290.40');assert.equal(p.unrealizedCad,'27.80');
});
test('CDR is a CAD instrument valued independently from its US underlying',()=>{
  const p=pos('SYN-TFSA','SYN-CAD-CDR');
  assert.equal(p.quantity,'4.0000');assert.equal(p.costCad,'160.00');assert.equal(p.marketValueCad,'220.00');assert.equal(p.realizedCad,'10.00');
});
test('account segregation and cash flow reconcile to manually calculated totals',()=>{
  assert.equal(acct('SYN-TAXABLE').cashCad,'1743.40');
  assert.equal(acct('SYN-TAXABLE').totalValueCad,'2614.80');
  assert.equal(acct('SYN-TAXABLE').depositsCad,'2300.00');
  assert.equal(acct('SYN-TFSA').cashCad,'350.00');
  assert.equal(acct('SYN-TFSA').totalValueCad,'570.00');
});
test('no cross-account basis pooling of TFSA and taxable positions',()=>{
  const f=clone(goldSyntheticFixture);
  f.events.push({id:'E14',date:'2026-08-01',accountId:'SYN-TAXABLE',type:'buy',securityId:'SYN-CAD-CDR',currency:'CAD',price:'20',quantity:'1',fee:'0'});
  const data=calculateSyntheticLedger(f);
  assert.equal(data.accounts.find(a=>a.id==='SYN-TFSA').positions.find(p=>p.securityId==='SYN-CAD-CDR').costCad,'160.00');
  assert.equal(data.accounts.find(a=>a.id==='SYN-TAXABLE').positions.find(p=>p.securityId==='SYN-CAD-CDR').costCad,'20.00');
});
test('rejects live input and synthetic=false',()=>{
  assert.throws(()=>calculateSyntheticLedger({...goldSyntheticFixture,synthetic:false}),/Synthetic fixture required/);
});
test('rejects over-sale and negative cash without margin support',()=>{
  const f=clone(goldSyntheticFixture);
  f.events.find(e=>e.id==='E08').quantity='100';
  assert.throws(()=>calculateSyntheticLedger(f),/Overselling/);
  const g=clone(goldSyntheticFixture);
  g.events.find(e=>e.id==='E03').price='1000';
  assert.throws(()=>calculateSyntheticLedger(g),/Insufficient CAD cash/);
});
test('rejects unsupported ROC beyond basis, no silent negative ACB',()=>{
  const f=clone(goldSyntheticFixture);f.events.find(e=>e.id==='E06').amount='9999';
  assert.throws(()=>calculateSyntheticLedger(f),/ROC exceeds basis/);
});
test('rejects mismatched CAD CDR and source quote currency',()=>{
  const f=clone(goldSyntheticFixture);f.securities.find(s=>s.kind==='cdr').currency='USD';
  assert.throws(()=>calculateSyntheticLedger(f),/CAD CDR/);
  const g=clone(goldSyntheticFixture);g.quotes.find(q=>q.securityId==='SYN-CAD-CDR').currency='USD';
  assert.throws(()=>calculateSyntheticLedger(g),/Quote currency mismatch/);
});
test('rejects missing FX, ambiguous quote, missing quote, out of order events',()=>{
  const f=clone(goldSyntheticFixture);delete f.events.find(e=>e.id==='E13').fxToCad;
  assert.throws(()=>calculateSyntheticLedger(f),/Amounts must be finite decimal strings/);
  const g=clone(goldSyntheticFixture);g.quotes.push(g.quotes[0]);
  assert.throws(()=>calculateSyntheticLedger(g),/Invalid quote identifier/);
  const h=clone(goldSyntheticFixture);h.quotes=h.quotes.filter(q=>q.securityId!=='SYN-CAD-CDR');
  assert.throws(()=>calculateSyntheticLedger(h),/without a quote/);
  const i=clone(goldSyntheticFixture);i.events[3].date='2025-01-01';
  assert.throws(()=>calculateSyntheticLedger(i),/out-of-order event/);
});
test('fixtures contain no actual financial records',()=>{
  assert.equal(goldSyntheticFixture.synthetic,true);
  assert.ok(goldSyntheticFixture.accounts.every(a=>a.id.startsWith('SYN-')));
  assert.ok(goldSyntheticFixture.securities.every(s=>s.id.startsWith('SYN-')));
});
