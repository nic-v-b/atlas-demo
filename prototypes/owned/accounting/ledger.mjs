import { Q } from './rational.mjs';

// A clean-room, synthetic-only accounting oracle used to compare applications.
// It does not copy upstream code, write any files, fetch data or expose an HTTP API.
// Not production accounting, Canadian tax software, TWR/MWR, or a complete ledger.
const ZERO = Q.zero();
const money = (value) => Q.of(value);
const positive = (value, label) => {
  const x = money(value);
  if (x.cmp(ZERO) <= 0) throw new Error(label + ' must be positive');
  return x;
};
const nonnegative = (value, label) => {
  const x = money(value);
  if (x.cmp(ZERO) < 0) throw new Error(label + ' must be nonnegative');
  return x;
};
const supportedKind = new Set(['mutual-fund', 'equity', 'cdr', 'etf']);
const knownTypes = new Set(['deposit', 'buy', 'sell', 'dividend', 'roc', 'notional', 'drip']);
const usd = 'USD';
const cad = 'CAD';
function convert(amount, currency, rate) {
  if (currency === cad) {
    if (rate !== undefined && money(rate).cmp(money('1')) !== 0) throw new Error('CAD transaction requires FX 1');
    return amount;
  }
  if (currency !== usd) throw new Error('Unsupported currency');
  return amount.mul(positive(rate, 'USD/CAD FX rate'));
}
function upsertPosition(account, assetId) {
  if (!account.positions.has(assetId)) account.positions.set(assetId, { quantity: ZERO, costCad: ZERO, realizedCad: ZERO, incomeCad: ZERO });
  return account.positions.get(assetId);
}
function requirePosition(account, assetId) {
  const p = account.positions.get(assetId);
  if (!p || p.quantity.cmp(ZERO) <= 0) throw new Error('Cannot adjust/sell a position with zero or missing units');
  return p;
}
function securityFor(securities, assetId, e) {
  const sec = securities.get(assetId);
  if (!sec) throw new Error('Unknown security');
  if (e.currency !== sec.currency) throw new Error('Quote currency does not match security identity');
  return sec;
}
function buy(account, sec, event) {
  const q = positive(event.quantity, 'Quantity');
  const price = positive(event.price, 'Price');
  const fee = nonnegative(event.fee || '0', 'Fee');
  const totalCad = convert(q.mul(price).add(fee), sec.currency, event.fxToCad);
  if (account.cashCad.cmp(totalCad) < 0) throw new Error('Insufficient CAD cash (no margin support)');
  const p = upsertPosition(account, sec.id);
  p.quantity = p.quantity.add(q);
  p.costCad = p.costCad.add(totalCad);
  account.cashCad = account.cashCad.sub(totalCad);
}
function sell(account, sec, event) {
  const p = requirePosition(account, sec.id);
  const q = positive(event.quantity, 'Quantity');
  if (q.cmp(p.quantity) > 0) throw new Error('Overselling unsupported');
  const price = positive(event.price, 'Price');
  const fee = nonnegative(event.fee || '0', 'Fee');
  const gross = q.mul(price);
  if (fee.cmp(gross) > 0) throw new Error('Sale fees exceed proceeds (unsupported)');
  const proceedsCad = convert(gross.sub(fee), sec.currency, event.fxToCad);
  const removedBasis = p.costCad.mul(q).div(p.quantity);
  p.costCad = p.costCad.sub(removedBasis);
  p.quantity = p.quantity.sub(q);
  p.realizedCad = p.realizedCad.add(proceedsCad.sub(removedBasis));
  account.cashCad = account.cashCad.add(proceedsCad);
}
export function calculateSyntheticLedger(fixture) {
  if (!fixture || fixture.synthetic !== true) throw new Error('Synthetic fixture required');
  if (!Array.isArray(fixture.accounts) || !Array.isArray(fixture.securities) || !Array.isArray(fixture.events)) throw new Error('Malformed fixture');
  const accounts = new Map();
  const securities = new Map();
  for (const a of fixture.accounts) {
    if (!a.id || accounts.has(a.id) || a.currency !== cad || !['taxable', 'tfsa'].includes(a.type)) throw new Error('Invalid synthetic account');
    accounts.set(a.id, { id:a.id, type:a.type, cashCad:ZERO, depositsCad:ZERO, positions:new Map() });
  }
  for (const s of fixture.securities) {
    if (!s.id || securities.has(s.id) || !supportedKind.has(s.kind) || ![cad,usd].includes(s.currency)) throw new Error('Invalid security master');
    if (s.kind === 'cdr' && s.currency !== cad) throw new Error('CAD CDR must use its actual CAD instrument quote');
    securities.set(s.id, { ...s });
  }
  const seen = new Set();
  let lastDate = '';
  for (const e of fixture.events) {
    if (!e.id || seen.has(e.id) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date < lastDate || !knownTypes.has(e.type)) throw new Error('Invalid, duplicate or out-of-order event');
    lastDate = e.date;
    seen.add(e.id);
    const a = accounts.get(e.accountId);
    if (!a) throw new Error('Unknown account');
    if (e.type === 'deposit') {
      const amount = positive(e.amount, 'Deposit');
      if (e.currency !== cad) throw new Error('Synthetic deposits require CAD');
      a.cashCad = a.cashCad.add(amount); a.depositsCad = a.depositsCad.add(amount);
      continue;
    }
    const sec = securityFor(securities, e.securityId, e);
    if (e.type === 'buy') buy(a, sec, e);
    else if (e.type === 'sell') sell(a, sec, e);
    else if (e.type === 'dividend') {
      const p = requirePosition(a, sec.id);
      const amountCad = convert(positive(e.amount, 'Dividend'), sec.currency, e.fxToCad);
      a.cashCad = a.cashCad.add(amountCad); p.incomeCad = p.incomeCad.add(amountCad);
    } else if (e.type === 'roc') {
      const p = requirePosition(a, sec.id);
      const amountCad = convert(positive(e.amount, 'Return of capital'), sec.currency, e.fxToCad);
      // Fail closed: simplified oracle does not yet implement excess ROC as gain.
      if (amountCad.cmp(p.costCad) > 0) throw new Error('ROC exceeds basis: unsupported tax case');
      p.costCad = p.costCad.sub(amountCad); a.cashCad = a.cashCad.add(amountCad);
    } else if (e.type === 'notional') {
      const p = requirePosition(a, sec.id);
      const amountCad = convert(positive(e.amount, 'Notional distribution'), sec.currency, e.fxToCad);
      p.costCad = p.costCad.add(amountCad); p.incomeCad = p.incomeCad.add(amountCad);
    } else if (e.type === 'drip') {
      // This educational DRIP model is cash-neutral and supports no
      // reinvestment fee/currency-wallet transfer. Reject silent net cash drift.
      const p = requirePosition(a, sec.id);
      const incomeCad = convert(positive(e.amount, 'DRIP income'), sec.currency, e.fxToCad);
      const reinvestmentFee = nonnegative(e.fee || '0', 'DRIP fee');
      if (reinvestmentFee.cmp(ZERO) !== 0) throw new Error('DRIP with fee unsupported by cash-neutral fixture');
      const reinvestCost = convert(
        positive(e.quantity, 'DRIP units').mul(positive(e.price, 'DRIP unit price')),
        sec.currency, e.fxToCad
      );
      if (incomeCad.cmp(reinvestCost) !== 0) throw new Error('DRIP cash-neutrality mismatch');
      a.cashCad = a.cashCad.add(incomeCad);
      p.incomeCad = p.incomeCad.add(incomeCad);
      buy(a, sec, e);
    }
  }
  const quotes = new Map();
  for (const item of fixture.quotes || []) {
    if (!securities.has(item.securityId) || quotes.has(item.securityId)) throw new Error('Invalid quote identifier');
    const sec = securities.get(item.securityId);
    if (item.currency !== sec.currency) throw new Error('Quote currency mismatch');
    quotes.set(item.securityId, convert(positive(item.price, 'Quote'), sec.currency, item.fxToCad));
  }
  const output = [];
  for (const a of accounts.values()) {
    let holdingsValue = ZERO, totalBasis = ZERO, totalRealized = ZERO, totalIncome = ZERO;
    const positions = [];
    for (const [securityId, p] of a.positions) {
      const quote = quotes.get(securityId);
      if (!quote && p.quantity.cmp(ZERO) > 0) throw new Error('Cannot value holding without a quote');
      const marketValue = p.quantity.cmp(ZERO) > 0 ? p.quantity.mul(quote) : ZERO;
      const unrealized = marketValue.sub(p.costCad);
      holdingsValue = holdingsValue.add(marketValue);
      totalBasis = totalBasis.add(p.costCad);
      totalRealized = totalRealized.add(p.realizedCad);
      totalIncome = totalIncome.add(p.incomeCad);
      positions.push(Object.freeze({ securityId, kind: securities.get(securityId).kind,
        quantity: p.quantity.fixed(4), costCad: p.costCad.fixed(), marketValueCad: marketValue.fixed(),
        realizedCad: p.realizedCad.fixed(), unrealizedCad: unrealized.fixed(), incomeCad: p.incomeCad.fixed()
      }));
    }
    output.push(Object.freeze({ id:a.id, type:a.type, cashCad:a.cashCad.fixed(), depositsCad:a.depositsCad.fixed(),
      holdingsValueCad:holdingsValue.fixed(), costCad:totalBasis.fixed(),
      totalValueCad:a.cashCad.add(holdingsValue).fixed(), realizedCad:totalRealized.fixed(), incomeCad:totalIncome.fixed(),
      positions }));
  }
  return Object.freeze({ synthetic:true, accountingScope:'educational acceptance oracle (NOT Canadian tax compliant)', accounts:output });
}
