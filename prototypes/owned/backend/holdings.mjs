import {Q} from '../accounting/rational.mjs';
import {calculateSyntheticExposure} from './exposure.mjs';

// Original, stateless ATLAS synthetic Holdings calculation service.
// NOT a brokerage ledger, Canadian tax engine, exchange-rate provider,
// private monetary vault, trade planner or account importer.
// The only calling HTTP route supplies an immutable in-repository fixture.
const Z=Q.zero(), ONE=Q.of('1'), HUNDRED=Q.of('100');
const val=x=>Q.of(x);
function positive(x,label){const n=val(x);if(n.cmp(Z)<=0)throw Error(label+' must be positive');return n;}
function nonnegative(x,label){const n=val(x);if(n.cmp(Z)<0)throw Error(label+' must be nonnegative');return n;}
function units(q){
  const [a,b]=q.fixed(12).split('.');
  return a+'.'+b.replace(/0+$/,'').padEnd(4,'0');
}
const money=q=>q.fixed(2);
const code=id=>typeof id==='string'&&/^SYN-[A-Z0-9-]{2,64}$/.test(id);
const currencies=['CAD','USD'];
const kinds=['etf','fund','equity','cdr'];
function currency(c){if(!currencies.includes(c))throw Error('Unsupported currency');return c;}
function sum(items){return items.reduce((a,b)=>a.add(b),Z);}
function getWallet(a,c){return a.wallets.get(c)??Z;}
function setWallet(a,c,value){
  if(value.cmp(Z)<0)throw Error('Insufficient '+c+' cash; margin not supported');
  a.wallets.set(c,value);
}
function position(a,id){
  if(!a.positions.has(id))a.positions.set(id,{units:Z,basis:Z,realized:Z,income:Z});
  return a.positions.get(id);
}
function calendarDate(date){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid ISO calendar date');
  const instant=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(instant.getTime())||instant.toISOString().slice(0,10)!==date)
    throw Error('Invalid ISO calendar date');
}
function strictEvent(e){
  if(!code(e.id)||!code(e.accountId))throw Error('Synthetic event/account IDs required');
  const permitted={
    deposit:['id','accountId','date','seq','type','currency','amount'],
    exchange:['id','accountId','date','seq','type','from','to','amount','rate','fee'],
    buy:['id','accountId','date','seq','type','currency','securityId','quantity','unitPrice','fee'],
    sell:['id','accountId','date','seq','type','currency','securityId','quantity','unitPrice','fee'],
    dividend:['id','accountId','date','seq','type','currency','securityId','amount']
  };
  const whitelist=permitted[e.type];
  if(!whitelist)throw Error('Unsupported event type');
  for(const k of Object.keys(e))if(!whitelist.includes(k))throw Error('Unsupported transaction metadata: '+k);
  calendarDate(e.date);
  if(!Number.isSafeInteger(e.seq)||e.seq<0)throw Error('Invalid event ordering/date');
}
function eventsLedger(fixture){
  const accounts=new Map(),securities=new Map(),seen=new Set();
  for(const a of fixture.accounts){
    if(!code(a.id)||!code(a.ownerId)||accounts.has(a.id)||!['taxable','tfsa','rrsp'].includes(a.type))throw Error('Invalid account');
    accounts.set(a.id,{...a,currency:currency(a.currency),wallets:new Map(),positions:new Map()});
  }
  for(const s of fixture.securities){
    if(!code(s.id)||securities.has(s.id)||!kinds.includes(s.kind))throw Error('Invalid security identity');
    if(s.kind==='cdr'&&s.currency!=='CAD')throw Error('Canadian CDR identity must be denominated in CAD');
    securities.set(s.id,{...s,currency:currency(s.currency)});
  }
  let lastDate='',lastSeq=-1;
  for(const e of fixture.events){
    strictEvent(e);
    if(seen.has(e.id)||e.date<lastDate||(e.date===lastDate&&e.seq<=lastSeq))throw Error('Out-of-order or duplicate journal event');
    if(e.date>fixture.asOf)throw Error('Future event after valuation date');
    lastDate=e.date;lastSeq=e.seq;seen.add(e.id);
    const a=accounts.get(e.accountId);
    if(!a)throw Error('Unknown account');
    if(e.type==='deposit'){
      const c=currency(e.currency);
      setWallet(a,c,getWallet(a,c).add(positive(e.amount,'Deposit')));
      continue;
    }
    if(e.type==='exchange'){
      const from=currency(e.from),to=currency(e.to);
      if(from===to)throw Error('Exchange requires different currency wallets');
      const amount=positive(e.amount,'Exchange amount'),fee=nonnegative(e.fee??'0','Exchange fee');
      const rate=positive(e.rate,'From-to exchange rate');
      setWallet(a,from,getWallet(a,from).sub(amount.add(fee)));
      setWallet(a,to,getWallet(a,to).add(amount.mul(rate)));
      continue;
    }
    const sec=securities.get(e.securityId);
    if(!sec||!code(e.securityId)||e.currency!==sec.currency)throw Error('Transaction quote currency mismatch');
    const c=sec.currency,p=position(a,sec.id);
    if(e.type==='buy'){
      const qty=positive(e.quantity,'Units'),price=positive(e.unitPrice,'Price'),fee=nonnegative(e.fee??'0','Buy fee');
      const cost=qty.mul(price).add(fee);
      setWallet(a,c,getWallet(a,c).sub(cost));
      p.units=p.units.add(qty);p.basis=p.basis.add(cost);
    }else if(e.type==='sell'){
      const qty=positive(e.quantity,'Units'),price=positive(e.unitPrice,'Price'),fee=nonnegative(e.fee??'0','Sell fee');
      if(qty.cmp(p.units)>0)throw Error('Cannot sell units not owned by account');
      const gross=qty.mul(price);
      if(fee.cmp(gross)>0)throw Error('Sell fee exceeds proceeds');
      const removed=p.basis.mul(qty).div(p.units);
      p.units=p.units.sub(qty);p.basis=p.basis.sub(removed);
      p.realized=p.realized.add(gross.sub(fee).sub(removed));
      setWallet(a,c,getWallet(a,c).add(gross.sub(fee)));
    }else if(e.type==='dividend'){
      if(p.units.cmp(Z)<=0)throw Error('Income requires previously held security');
      const amount=positive(e.amount,'Dividend');
      setWallet(a,c,getWallet(a,c).add(amount));p.income=p.income.add(amount);
    }
  }
  return {accounts,securities};
}
function cad(amount,c,fx){return c==='CAD'?amount:fx?amount.mul(fx):null;}
export function calculateSyntheticHoldings(fixture,{accountIds=null}={}){
  if(!fixture||fixture.synthetic!==true)throw Error('Only synthetic Holdings fixtures accepted');
  if(!Array.isArray(fixture.accounts)||!Array.isArray(fixture.securities)||
     !Array.isArray(fixture.events)||!Array.isArray(fixture.quotes))throw Error('Malformed fixture');
  // Quotes, FX, classifications and policy must match this valid calendar day.
  calendarDate(fixture.asOf);
  const {accounts,securities}=eventsLedger(fixture);
  const selected=accountIds===null?[...accounts.keys()]:accountIds;
  if(!Array.isArray(selected)||selected.length===0||new Set(selected).size!==selected.length||
     selected.some(id=>!accounts.has(id)))throw Error('Unknown, empty or duplicate account selection');
  const quotes=new Map();
  for(const q of fixture.quotes){
    const s=securities.get(q.securityId);
    if(!s||q.currency!==s.currency||quotes.has(s.id)||q.asOf!==fixture.asOf)throw Error('Missing or stale native quote metadata');
    quotes.set(s.id,positive(q.unitPrice,'Quote price'));
  }
  let fx=null,fxMeta=null;
  if(fixture.valuationFx!==undefined){
    const f=fixture.valuationFx;
    if(f.from!=='USD'||f.to!=='CAD'||f.asOf!==fixture.asOf)throw Error('Stale/ambiguous valuation FX direction');
    fx=positive(f.rate,'Valuation USD-to-CAD rate');
    // An exchange-rate multiplier is not a two-decimal money amount.
    // Preserve the validated input precision so the stated FX rate reproduces valuation.
    fxMeta={from:'USD',to:'CAD',rate:f.rate,asOf:f.asOf,source:'Fictional fixed FX snapshot'};
  }
  const totals={CAD:{cash:Z,positions:Z},USD:{cash:Z,positions:Z}};
  const perAccount=[],positions=[],alloc=new Map(),exposureHoldings=[];
  // JSON-safe exact fractions are validation evidence, never rounded inputs.
  const exact=value=>({n:String(value.n),d:String(value.d)});
  const valuationInputs={accounts:[],positions:[]};
  for(const [id,a] of accounts){
    if(!selected.includes(id))continue;
    const byCur={CAD:{cash:getWallet(a,'CAD'),positions:Z},USD:{cash:getWallet(a,'USD'),positions:Z}};
    for(const [securityId,p] of a.positions){
      if(p.units.cmp(Z)===0)continue;
      const sec=securities.get(securityId),q=quotes.get(securityId);
      if(!q)throw Error('Missing quote for open position');
      const market=p.units.mul(q),unrealized=market.sub(p.basis),c=sec.currency;
      valuationInputs.positions.push({accountId:id,securityId:sec.id,marketValue:exact(market)});
      byCur[c].positions=byCur[c].positions.add(market);
      const cadMarket=cad(market,c,fx);
      if(cadMarket!==null){
        alloc.set(sec.kind,(alloc.get(sec.kind)??Z).add(cadMarket));
        exposureHoldings.push({securityId:sec.id,kind:sec.kind,marketCad:cadMarket,analysis:sec.analysis??null});
      }
      positions.push({
        accountId:id,accountLabel:a.label,accountType:a.type,
        securityId:sec.id,symbol:sec.symbol,name:sec.name,kind:sec.kind,currency:c,
        quantity:units(p.units),unitQuote:money(q),
        bookValueNative:money(p.basis),marketValueNative:money(market),
        unrealizedNative:money(unrealized),incomeNative:money(p.income),
        marketValueCadEquivalent:cadMarket===null?null:money(cadMarket),
        quoteAsOf:fixture.asOf
      });
    }
    const pockets={};
    for(const c of currencies){
      totals[c].cash=totals[c].cash.add(byCur[c].cash);
      totals[c].positions=totals[c].positions.add(byCur[c].positions);
      pockets[c]={
        cash:money(byCur[c].cash),positionValue:money(byCur[c].positions),
        total:money(byCur[c].cash.add(byCur[c].positions))
      };
    }
    perAccount.push({id:a.id,label:a.label,type:a.type,baseCurrency:a.currency,pockets});
    valuationInputs.accounts.push({accountId:id,...Object.fromEntries(currencies.map(c=>[c,{
      cash:exact(byCur[c].cash),positionValue:exact(byCur[c].positions)
    }]))});
  }
  const currencyTotals={};
  for(const c of currencies){
    currencyTotals[c]={
      cash:money(totals[c].cash),
      positionValue:money(totals[c].positions),
      total:money(totals[c].cash.add(totals[c].positions))
    };
  }
  const cadEquivalent=fx?totals.CAD.cash.add(totals.CAD.positions)
    .add(totals.USD.cash.add(totals.USD.positions).mul(fx))
    : totals.USD.cash.add(totals.USD.positions).cmp(Z)===0
      ? totals.CAD.cash.add(totals.CAD.positions):null;
  // Determine emptiness from exact values, never from rounded display cents.
  const valuationState=cadEquivalent===null?'missing-fx':cadEquivalent.cmp(Z)===0?'empty':'valued';
  let allocation=null,takeaway,exposure=null;
  if(cadEquivalent!==null&&cadEquivalent.cmp(Z)>0){
    const cash=totals.CAD.cash.add(totals.USD.cash.mul(fx??ONE));
    exposure=calculateSyntheticExposure({
      holdings:exposureHoldings,cashCad:cash,totalCad:cadEquivalent,asOf:fixture.asOf,
      exampleSectorPolicy:fixture.exampleSectorPolicy??null
    });
    const weights=new Map(alloc);
    weights.set('cash',(weights.get('cash')??Z).add(cash));
    allocation=['etf','fund','equity','cdr','cash'].map(kind=>({
      kind,percent:Number(weights.get(kind)?.div(cadEquivalent).mul(HUNDRED).fixed(1)??'0.0')
    }));
    const cashPct=Number(cash.div(cadEquivalent).mul(HUNDRED).fixed(1));
    takeaway=cashPct>40?{
      state:'review',title:'Cash allocation merits a look',
      text:cashPct.toFixed(1)+'% of this fictional selection is held in cash, using the explicit synthetic CAD valuation rate. This is context for review, not a trade recommendation.',
      evidence:'Derived from selected cash wallets and the fictional as-of FX snapshot'
    }:{
      state:'routine',title:'Selected holdings reconciled',
      text:'Currency-specific cash and positions reconcile for this fictional selection. Monitor the figures and supporting quote dates before making any interpretation.',
      evidence:'Derived from the synthetic event journal and manual quote snapshot'
    };
  }else if(valuationState==='empty'){
    takeaway={state:'empty',title:'No cash or positions in this selection',
      text:'These fictional accounts have no cash or open positions. There are no portfolio weights or invested exposures to calculate.',
      evidence:'Zero native cash wallets and no open positions in the selected synthetic accounts'};
  }else{
    takeaway={state:'unavailable',title:'Combined valuation unavailable',
      text:'No verified same-date FX rate is available for a combined CAD-equivalent total. CAD and USD amounts remain separate.',
      evidence:'Mixed-currency totals cannot be added without an explicit valuation rate'};
  }
  return {
    synthetic:true,scope:'Fictional investment research only',taxReady:false,
    asOf:fixture.asOf,accountOptions:[...accounts.values()].map(a=>({
      id:a.id,label:a.label,type:a.type,baseCurrency:a.currency
    })),
    selectedAccountIds:selected.slice(),accountCount:selected.length,
    perAccount,currencyTotals,positions,valuationInputs,fx:fxMeta,
    cadEquivalent:cadEquivalent===null?null:money(cadEquivalent),
    valuationState,allocation,exposure,takeaway,
    limitations:'Native book cost is NOT pooled Canadian taxable ACB; income is not a total-return metric; no real balances, brokerage connections or production storage'
  };
}
