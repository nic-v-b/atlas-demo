import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCurrencyScenario } from './r0e-currency-oracle.mjs';
import { r0eSyntheticCurrencyFixture } from './r0e-currency-fixture.mjs';
const clone = (x) => structuredClone(x);
const result = evaluateCurrencyScenario(r0eSyntheticCurrencyFixture);
const account = id => result.accounts.find(a=>a.accountId===id);
const holding = id => account(id).positions[0];

test('fixture is entirely synthetic with independent account IDs',()=>{
  assert.equal(result.synthetic,true);
  assert.equal(result.accounts.length,3);
  assert.ok(r0eSyntheticCurrencyFixture.accounts.every(a=>a.id.startsWith('SYN-')));
  assert.ok(r0eSyntheticCurrencyFixture.securities.every(a=>a.id.startsWith('SYN-')));
});
test('USD acquisition in CAD account uses transaction FX and includes USD fee',()=>{
  const a=account('SYN-CAD-FX-TEST');
  assert.equal(holding(a.accountId).quantity,'2.0000');
  assert.equal(holding(a.accountId).basisAccount,'262.60');
  assert.equal(a.cashByCurrency.CAD,'737.40');
});
test('a USD dividend without conversion remains in USD pocket, not CAD pocket',()=>{
  const a=account('SYN-CAD-FX-TEST');
  assert.equal(a.cashByCurrency.CAD,'737.40');
  assert.equal(a.cashByCurrency.USD,'10.00');
  assert.deepEqual(holding(a.accountId).incomeByCurrency,{USD:'10.00'});
});
test('fictional valuation FX differs from historical acquisition FX',()=>{
  const p=holding('SYN-CAD-FX-TEST');
  assert.equal(p.marketValueAccount,'290.40');
  assert.equal(p.unrealizedAccount,'27.80');
});
test('no fabricated CAD total value is computed for mixed-currency cash',()=>{
  assert.equal(account('SYN-CAD-FX-TEST').totalValueCAD,undefined);
  assert.equal(account('SYN-CAD-FX-TEST').cashByCurrency.USD,'10.00');
});
test('USD cash account can buy USD asset without transaction FX',()=>{
  const a=account('SYN-USD-ACCOUNT-TEST'), p=holding(a.accountId);
  assert.equal(a.cashByCurrency.USD,'200.00');
  assert.equal(p.basisAccount,'100.00');
  assert.equal(p.marketValueAccount,'110.00');
  assert.equal(p.unrealizedAccount,'10.00');
});
test('CAD CDR settles in CAD, independently valued against its own CAD quote',()=>{
  const a=account('SYN-CAD-CDR-TEST'),p=holding(a.accountId);
  assert.equal(a.cashByCurrency.CAD,'300.00');
  assert.equal(p.nativeCurrency,'CAD');
  assert.equal(p.quantity,'5.0000');
  assert.equal(p.basisAccount,'200.00');
  assert.equal(p.marketValueAccount,'275.00');
  assert.equal(p.unrealizedAccount,'75.00');
});
test('cross-currency purchase refuses missing historical FX',()=>{
  const f=clone(r0eSyntheticCurrencyFixture);
  delete f.events.find(e=>e.id==='SYN-E4').fxToAccount;
  assert.throws(()=>evaluateCurrencyScenario(f),/Amounts must be finite decimal strings/);
});
test('valuation fails on missing or invalid account-currency FX',()=>{
  const f=clone(r0eSyntheticCurrencyFixture);
  delete f.quotes.find(e=>e.assetId==='SYN-USD-TEST').fxToAccount;
  assert.throws(()=>evaluateCurrencyScenario(f),/Amounts must be finite decimal strings/);
  const g=clone(r0eSyntheticCurrencyFixture);
  g.quotes.find(e=>e.assetId==='SYN-USD-TEST').fxToAccount='0';
  assert.throws(()=>evaluateCurrencyScenario(g),/Valuation FX must be positive/);
});
test('USD asset cannot masquerade as CAD denomination for transaction',()=>{
  const f=clone(r0eSyntheticCurrencyFixture);
  f.events.find(e=>e.id==='SYN-E4').currency='CAD';
  assert.throws(()=>evaluateCurrencyScenario(f),/Asset\/activity currency mismatch/);
});
test('CAD CDR is a distinct CAD-quoted security and rejects relabeling',()=>{
  const f=clone(r0eSyntheticCurrencyFixture);
  f.securities.find(s=>s.id==='SYN-CDR-TEST').currency='USD';
  assert.throws(()=>evaluateCurrencyScenario(f),/CAD-listed CDR quote must be CAD/);
});
test('no unapproved conversion of USD dividend through fx-rate field',()=>{
  const f=clone(r0eSyntheticCurrencyFixture);
  f.events.find(e=>e.id==='SYN-E7').fxToAccount='1.30';
  assert.throws(()=>evaluateCurrencyScenario(f),/Unconverted dividend fixture must not specify FX/);
});
test('FX unit convention is explicit: USD-to-CAD, not reciprocal',()=>{
  const f=clone(r0eSyntheticCurrencyFixture);
  f.events.find(e=>e.id==='SYN-E4').fxToAccount='0.769230769';
  const a=evaluateCurrencyScenario(f).accounts.find(a=>a.accountId==='SYN-CAD-FX-TEST');
  assert.notEqual(a.cashByCurrency.CAD,'737.40');
});
test('insufficient cash rejects rather than opens an unmodeled margin loan',()=>{
  const f=clone(r0eSyntheticCurrencyFixture);
  f.events.find(e=>e.id==='SYN-E4').quantity='100';
  assert.throws(()=>evaluateCurrencyScenario(f),/Insufficient cash/);
});
test('rejects non-synthetic use and duplicate quotes/events',()=>{
  assert.throws(()=>evaluateCurrencyScenario({...r0eSyntheticCurrencyFixture,synthetic:false}),/Synthetic scenario required/);
  const f=clone(r0eSyntheticCurrencyFixture);
  f.quotes.push(f.quotes[0]);
  assert.throws(()=>evaluateCurrencyScenario(f),/Invalid duplicate\/unknown quote/);
  const g=clone(r0eSyntheticCurrencyFixture);
  g.events[1].id=g.events[0].id;
  assert.throws(()=>evaluateCurrencyScenario(g),/Invalid duplicate/);
});
