import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSyntheticLedger } from './ledger.mjs';
import { syntheticDistributions, syntheticFxAndCdr, syntheticTaxablePoolingGap } from './r0d-fixtures.mjs';
const copy = x => structuredClone(x);
const account = (data, id) => calculateSyntheticLedger(data).accounts.find(a=>a.id===id);
const pos = (a,id) => a.positions.find(x=>x.securityId===id);
const stages = n => {
  const x = copy(syntheticDistributions);
  x.events = x.events.slice(0,n);
  return account(x,'SYN-DISTRIBUTIONS');
};
test('distribution starting account and purchase: exact cash and book cost', () => {
  const a = stages(2), p = pos(a,'SYN-DIST-FUND');
  assert.equal(a.cashCad,'800.00');
  assert.equal(p.quantity,'10.0000');
  assert.equal(p.costCad,'200.00');
  assert.equal(p.incomeCad,'0.00');
});
test('cash return of capital lowers ACB but is not ordinary dividend income', () => {
  const a = stages(3), p = pos(a,'SYN-DIST-FUND');
  assert.equal(a.cashCad,'820.00');
  assert.equal(p.quantity,'10.0000');
  assert.equal(p.costCad,'180.00');
  assert.equal(p.incomeCad,'0.00');
  assert.equal(p.realizedCad,'0.00');
});
test('DRIP increases units and cost, reports income, and conserves cash', () => {
  const a = stages(4), p = pos(a,'SYN-DIST-FUND');
  assert.equal(a.cashCad,'820.00');
  assert.equal(p.quantity,'11.0000');
  assert.equal(p.costCad,'205.00');
  assert.equal(p.incomeCad,'25.00');
});
test('notional distribution increases cost and income but adds no units or cash', () => {
  const a = stages(5), p = pos(a,'SYN-DIST-FUND');
  assert.equal(a.cashCad,'820.00');
  assert.equal(p.quantity,'11.0000');
  assert.equal(p.costCad,'215.00');
  assert.equal(p.incomeCad,'35.00');
  assert.equal(p.marketValueCad,'330.00');
  assert.equal(p.unrealizedCad,'115.00');
  assert.equal(a.totalValueCad,'1150.00');
});
test('a mismatched DRIP amount cannot create unexplained cash drift', () => {
  const f = copy(syntheticDistributions);
  f.events.find(e=>e.type==='drip').amount = '24';
  assert.throws(()=>calculateSyntheticLedger(f),/DRIP cash-neutrality mismatch/);
});
test('DRIP fee is not silently ignored or double-charged', () => {
  const f = copy(syntheticDistributions);
  f.events.find(e=>e.type==='drip').fee='1';
  assert.throws(()=>calculateSyntheticLedger(f),/DRIP with fee unsupported/);
});
test('ROC exceeding position cost is explicitly unsupported in this oracle', () => {
  const f = copy(syntheticDistributions);
  f.events.find(e=>e.type==='roc').amount = '201';
  assert.throws(()=>calculateSyntheticLedger(f),/ROC exceeds basis/);
});
test('historical CAD/USD acquisition differs from valuation FX, no US stock/CDR conflation', () => {
  const a = account(syntheticFxAndCdr,'SYN-FX-TAXABLE');
  const p = pos(a,'SYN-USD-ISSUER');
  assert.equal(a.cashCad,'737.40');
  assert.equal(p.costCad,'262.60');
  assert.equal(p.marketValueCad,'290.40');
  assert.equal(p.unrealizedCad,'27.80');
  assert.equal(a.totalValueCad,'1027.80');
});
test('Canadian-listed CDR uses its own CAD quote regardless of underlying identity', () => {
  const a = account(syntheticFxAndCdr,'SYN-CDR-TFSA');
  const p = pos(a,'SYN-CDR-ISSUER');
  assert.equal(a.cashCad,'300.00');
  assert.equal(p.quantity,'5.0000');
  assert.equal(p.costCad,'200.00');
  assert.equal(p.marketValueCad,'275.00');
  assert.equal(a.totalValueCad,'575.00');
});
test('missing acquisition or current FX rejects rather than assuming 1:1', () => {
  const f = copy(syntheticFxAndCdr);
  delete f.events.find(e=>e.securityId==='SYN-USD-ISSUER').fxToCad;
  assert.throws(()=>calculateSyntheticLedger(f),/Amounts must be finite decimal strings/);
  const g = copy(syntheticFxAndCdr);
  delete g.quotes.find(e=>e.securityId==='SYN-USD-ISSUER').fxToCad;
  assert.throws(()=>calculateSyntheticLedger(g),/Amounts must be finite decimal strings/);
});
test('per-account WAC diverges from cross-taxable-account Canadian pooled ACB', () => {
  const a = account(syntheticTaxablePoolingGap,'SYN-TAX-A');
  const b = account(syntheticTaxablePoolingGap,'SYN-TAX-B');
  assert.equal(pos(a,'SYN-IDENTICAL-ASSET').realizedCad,'50.00');
  assert.equal(pos(a,'SYN-IDENTICAL-ASSET').costCad,'100.00');
  assert.equal(pos(b,'SYN-IDENTICAL-ASSET').costCad,'400.00');
  // Same-owner identical property across two taxable accounts:
  // (10*20 + 10*40)/20=30 CAD/unit; 5 sold at 30 gives 0 gain, not 50.
  // This is a KNOWN UNSUPPORTED GAP, not an alternate implementation.
  const pooledSyntheticExpectedGain = '0.00';
  assert.notEqual(pos(a,'SYN-IDENTICAL-ASSET').realizedCad,pooledSyntheticExpectedGain);
});
test('TFSA book costs stay outside taxable pool', () => {
  const a = account(syntheticTaxablePoolingGap,'SYN-TFSA-OTHER');
  assert.equal(pos(a,'SYN-IDENTICAL-ASSET').costCad,'500.00');
  assert.equal(a.cashCad,'0.00');
});
test('all new R0d fixtures are fictional and require no market service', () => {
  for(const f of [syntheticDistributions,syntheticFxAndCdr,syntheticTaxablePoolingGap]) {
    assert.equal(f.synthetic,true);
    assert.ok(f.accounts.every(a=>a.id.startsWith('SYN-')));
    assert.ok(f.securities.every(s=>s.id.startsWith('SYN-')));
    assert.ok(f.events.every(e=>e.id && e.accountId.startsWith('SYN-')));
  }
});
