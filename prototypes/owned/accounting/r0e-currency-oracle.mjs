import { Q } from './rational.mjs';

// SYNTHETIC-ONLY exact arithmetic oracle. Not investment/tax/FX advice or
// production double-entry accounting. No I/O, network, persistence or AI.
const Z = Q.zero();
const dec = (v) => Q.of(v);
const pos = (v, name) => {
  const q = dec(v);
  if (q.cmp(Z) <= 0) throw new Error(name + ' must be positive');
  return q;
};
const nonneg = (v, name) => {
  const q = dec(v);
  if (q.cmp(Z) < 0) throw new Error(name + ' must be nonnegative');
  return q;
};
function put(wallet, currency, amount) {
  wallet.set(currency, (wallet.get(currency) ?? Z).add(amount));
}
function get(wallet, currency) { return wallet.get(currency) ?? Z; }
function settleBuyCost(event, accountCurrency, nativeCost) {
  if (event.currency === accountCurrency) {
    if (event.fxToAccount !== undefined && dec(event.fxToAccount).cmp(dec('1')) !== 0) {
      throw new Error('Same-currency trade cannot have a non-unit FX rate');
    }
    return nativeCost;
  }
  // Explicit historical FX; don't silently substitute today's FX or 1:1.
  return nativeCost.mul(pos(event.fxToAccount, 'Foreign buy settlement FX'));
}
function priceValue(quote, asset, accountCurrency, quantity) {
  if (!quote || quote.currency !== asset.currency) throw new Error('Missing or mismatched quote currency');
  const price = pos(quote.price, 'Manual quote');
  const nativeValue = price.mul(quantity);
  if (asset.currency === accountCurrency) {
    if (quote.fxToAccount !== undefined && dec(quote.fxToAccount).cmp(dec('1')) !== 0) {
      throw new Error('Same-currency quote has a non-unit FX rate');
    }
    return nativeValue;
  }
  return nativeValue.mul(pos(quote.fxToAccount, 'Valuation FX'));
}
export function evaluateCurrencyScenario(fixture) {
  if (!fixture || fixture.synthetic !== true) throw new Error('Synthetic scenario required');
  if (!Array.isArray(fixture.accounts) || !Array.isArray(fixture.securities) ||
    !Array.isArray(fixture.events) || !Array.isArray(fixture.quotes)) throw new Error('Malformed synthetic scenario');
  const accounts = new Map();
  const assets = new Map();
  for (const a of fixture.accounts) {
    if (typeof a.id !== 'string' || !a.id.startsWith('SYN-') || accounts.has(a.id) ||
      !['CAD','USD'].includes(a.currency) || !['taxable','tfsa'].includes(a.type)) {
      throw new Error('Invalid synthetic account');
    }
    accounts.set(a.id, { ...a, cash:new Map(), holdings:new Map() });
  }
  for (const a of fixture.securities) {
    if (typeof a.id !== 'string' || !a.id.startsWith('SYN-') || assets.has(a.id) ||
      !['CAD','USD'].includes(a.currency) || !['cdr','equity','fund'].includes(a.kind)) {
      throw new Error('Invalid synthetic asset');
    }
    if (a.kind === 'cdr' && a.currency !== 'CAD') throw new Error('CAD-listed CDR quote must be CAD');
    assets.set(a.id, { ...a });
  }
  const ids = new Set();
  let lastDate = '';
  for (const e of fixture.events) {
    if (!e.id || ids.has(e.id) || !/^\d{4}-\d\d-\d\d$/.test(e.date) ||
      e.date < lastDate || !['deposit','buy','dividend'].includes(e.type)) {
      throw new Error('Invalid duplicate, type or order of synthetic event');
    }
    ids.add(e.id); lastDate = e.date;
    const account = accounts.get(e.accountId);
    if (!account) throw new Error('Unknown account');
    if (e.type === 'deposit') {
      if (e.currency !== account.currency) throw new Error('Foreign deposit unsupported in this test');
      put(account.cash, e.currency, pos(e.amount, 'Deposit'));
      continue;
    }
    const asset = assets.get(e.assetId);
    if (!asset || asset.currency !== e.currency) throw new Error('Asset/activity currency mismatch');
    if (e.type === 'buy') {
      const quantity = pos(e.quantity, 'Quantity');
      const grossNative = quantity.mul(pos(e.unitPrice, 'Price'));
      const totalNative = grossNative.add(nonneg(e.fee ?? '0', 'Fee'));
      const totalAccount = settleBuyCost(e, account.currency, totalNative);
      if (get(account.cash, account.currency).cmp(totalAccount) < 0) {
        throw new Error('Insufficient cash in account currency: margin not supported');
      }
      put(account.cash, account.currency, totalAccount.mul(dec('-1')));
      const h = account.holdings.get(asset.id) ?? { quantity:Z, basisAccount:Z, income:new Map() };
      h.quantity = h.quantity.add(quantity);
      h.basisAccount = h.basisAccount.add(totalAccount);
      account.holdings.set(asset.id, h);
    } else if (e.type === 'dividend') {
      const h = account.holdings.get(asset.id);
      if (!h || h.quantity.cmp(Z) <= 0) throw new Error('Dividend requires existing security position');
      if (e.fxToAccount !== undefined) throw new Error('Unconverted dividend fixture must not specify FX');
      const amount = pos(e.amount, 'Cash dividend');
      // Unlike cross-currency BUY with explicit FX, cash dividend stays
      // in its own currency. Does NOT alter basis or unit count.
      put(account.cash, e.currency, amount);
      put(h.income, e.currency, amount);
    }
  }
  const quotes = new Map();
  for (const q of fixture.quotes) {
    if (quotes.has(q.assetId) || !assets.has(q.assetId)) throw new Error('Invalid duplicate/unknown quote');
    quotes.set(q.assetId, q);
  }
  const result = [];
  for (const a of accounts.values()) {
    const positions = [];
    for (const [assetId,h] of a.holdings) {
      const value = priceValue(quotes.get(assetId), assets.get(assetId), a.currency, h.quantity);
      positions.push({
        assetId, kind:assets.get(assetId).kind, nativeCurrency:assets.get(assetId).currency,
        quantity:h.quantity.fixed(4), basisAccount:h.basisAccount.fixed(),
        marketValueAccount:value.fixed(),
        unrealizedAccount:value.sub(h.basisAccount).fixed(),
        incomeByCurrency:Object.fromEntries([...h.income].map(([k,v])=>[k,v.fixed()]))
      });
    }
    result.push({
      accountId:a.id, accountCurrency:a.currency, type:a.type,
      // NO total cash value: each cash pocket must be converted with
      // separately validated valuation-date rates first.
      cashByCurrency:Object.fromEntries([...a.cash].map(([k,v])=>[k,v.fixed()])),
      positions
    });
  }
  return { synthetic:true,
    limitation:'Educational event semantics; NOT production Canadian tax/currency accounting',
    accounts:result };
}
