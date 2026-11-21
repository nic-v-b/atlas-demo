// Versioned, synthetic-only wire contract. All three pages validate the ENTIRE
// envelope before touching the DOM. This checks projections, not journal truth
// or server authenticity; exact-rational accounting remains on the server.
import {Q} from '../accounting/rational.mjs';
export const JOURNAL_SCHEMA_VERSION=1;
export const JOURNAL_ID='SYN-R1A-CANONICAL';
const fail=()=>{throw Error('Canonical synthetic journal response rejected');};
const check=(condition)=>{if(!condition)fail();};
const text=x=>check(typeof x==='string'&&x.length>0&&x.length<=4000);
const literal=value=>x=>check(x===value);
const choice=values=>x=>check(values.includes(x));
const pattern=re=>x=>check(typeof x==='string'&&re.test(x));
const id=pattern(/^SYN-[A-Z0-9-]{2,64}$/);
const revision=pattern(/^[a-f0-9]{64}$/);
const date=x=>{
  pattern(/^\d{4}-\d{2}-\d{2}$/)(x);
  const d=new Date(x+'T00:00:00Z');
  check(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x);
};
const decimal=pattern(/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/);
const money=x=>{pattern(/^-?(?:0|[1-9]\d{0,14})\.\d{2}$/)(x);};
const positive=x=>{decimal(x);check(Number(x)>0);};
const nonnegative=x=>{decimal(x);check(Number(x)>=0);};
const cash=x=>{money(x);check(Number(x)>=0);};
const taxMoney=pattern(/^-?CA\$(?:0|[1-9]\d{0,14})\.\d{2}$/);
const taxCash=x=>{taxMoney(x);check(!x.startsWith('-'));};
const percent=x=>check(typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100);
const delta=x=>check(typeof x==='number'&&Number.isFinite(x)&&x>=-100&&x<=100);
const nullable=validate=>x=>{if(x!==null)validate(x);};
const array=(validate,min=0,max=1000)=>x=>{
  check(Array.isArray(x)&&x.length>=min&&x.length<=max);x.forEach(validate);
};
const shape=fields=>x=>{
  check(x!==null&&typeof x==='object'&&!Array.isArray(x));
  check(Object.keys(x).length===Object.keys(fields).length);
  for(const [key,validate] of Object.entries(fields)){
    check(Object.hasOwn(x,key));validate(x[key]);
  }
};
const same=(a,b)=>{
  if(a===b)return true;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
};
const ids=x=>{array(id,1,100)(x);check(new Set(x).size===x.length);};
const sameIds=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(x=>b.includes(x));
const currency=choice(['CAD','USD']);
const accountType=choice(['taxable','tfsa','rrsp']);
const accountFields={id,label:text,type:accountType,baseCurrency:currency};
const pocket=shape({cash,positionValue:cash,total:cash});
const totals=shape({CAD:pocket,USD:pocket});
const fraction=shape({n:pattern(/^(?:0|[1-9]\d{0,99})$/),d:pattern(/^[1-9]\d{0,99}$/)});
const exactPocket=shape({cash:fraction,positionValue:fraction});
const takeaway=shape({state:choice(['review','routine','empty','unavailable']),title:text,text,evidence:text});
const exposureRow=shape({key:text,label:text,valueCad:cash,percentOfPortfolio:percent,percentOfInvested:nullable(percent)});
const diagnostics=shape({cashPctOfPortfolio:percent,largestSector:nullable(exposureRow),largestGeography:nullable(exposureRow)});
const scope=shape({kind:literal('selected-accounts'),accountIds:ids});
const taxScope=shape({kind:literal('owner-taxable-property'),ownerId:id,identicalPropertyId:id,accountIds:ids});
const metadata={journalId:literal(JOURNAL_ID),journalRevision:revision,asOf:date};
const exposure=shape({
  synthetic:literal(true),asOf:date,basis:text,source:text,
  dimensions:shape(Object.fromEntries(['vehicle','strategy','sector','geography'].map(k=>[k,array(exposureRow,1)]))),
  etfMix:array(shape({key:text,label:text,valueCad:cash,percentOfEtfs:percent,percentOfPortfolio:percent})),
  exampleSectorComparison:nullable(shape({synthetic:literal(true),asOf:date,policyName:text,source:text,basis:text,
    rows:array(shape({key:text,label:text,actualPct:percent,targetPct:percent,deltaPp:delta,valueCad:cash}),1),limitations:text})),
  investedValueCad:cash,cashValueCad:cash,etfValueCad:cash,
  coverage:shape({sectorPctOfInvested:nullable(percent),geographyPctOfInvested:nullable(percent)}),
  diagnostics,limitations:text
});
const holdings=shape({
  ...metadata,selectionScope:scope,synthetic:literal(true),scope:literal('Fictional investment research only'),taxReady:literal(false),
  accountOptions:array(shape(accountFields),1,100),selectedAccountIds:ids,
  accountCount:x=>check(Number.isSafeInteger(x)&&x>0&&x<=100),
  perAccount:array(shape({...accountFields,pockets:totals}),1,100),currencyTotals:totals,
  positions:array(shape({accountId:id,accountLabel:text,accountType,securityId:id,symbol:text,name:text,
    kind:choice(['etf','fund','equity','cdr']),currency,quantity:positive,unitQuote:cash,
    bookValueNative:cash,marketValueNative:cash,unrealizedNative:money,incomeNative:cash,
    marketValueCadEquivalent:nullable(cash),quoteAsOf:date})),
  valuationInputs:shape({accounts:array(shape({accountId:id,CAD:exactPocket,USD:exactPocket}),1,100),
    positions:array(shape({accountId:id,securityId:id,marketValue:fraction}))}),
  fx:nullable(shape({from:literal('USD'),to:literal('CAD'),rate:positive,asOf:date,source:text})),
  cadEquivalent:nullable(cash),valuationState:choice(['valued','empty','missing-fx']),
  allocation:nullable(array(shape({kind:choice(['etf','fund','equity','cdr','cash']),percent}),5,5)),
  exposure:nullable(exposure),takeaway,limitations:text
});
const taxPool=shape({units:positive,cost:taxCash,average:taxCash});
const taxInput=shape({accountId:id,date,quantity:positive,unitPrice:positive,fee:nonnegative});
const taxLab=shape({
  ...metadata,taxScope,synthetic:literal(true),taxReady:literal(false),source:literal('R0f exact-rational synthetic ACB oracle'),
  before:taxPool,after:shape({units:nonnegative,cost:taxCash,average:x=>{if(x!=='—')taxCash(x);}}),
  calculationInputs:shape({purchases:array(taxInput,2,2),sale:taxInput}),
  accounts:array(shape({letter:choice(['A','B']),accountId:id,label:text,detail:text,cost:taxCash,pct:percent}),2,2),
  sale:shape({quantity:positive,accountLetter:choice(['A','B']),unitPrice:taxCash,proceeds:taxCash,
    allocatedAcb:taxCash,preliminaryGain:taxMoney,accountOnlyGain:taxMoney,accountOnlyFormula:text,
    pooledFormula:text,date,lossReview:nullable(text)}),
  timeline:array(shape({date,title:text,detail:text}),3,3),
  scope:literal('All fictional eligible taxable accounts for one owner; independent of Holdings filters'),limitations:text
});
const envelope=shape({
  schemaVersion:literal(JOURNAL_SCHEMA_VERSION),...metadata,synthetic:literal(true),selectionScope:scope,taxScope,
  overview:shape({...metadata,selectionScope:scope,synthetic:literal(true),selectedAccountIds:ids,
    currencyTotals:totals,cadEquivalent:nullable(cash),valuationState:choice(['valued','empty','missing-fx']),
    takeaway,exposureSummary:nullable(diagnostics)}),
  holdings,taxLab,
  reconciliation:shape({matched:literal(true),taxableUnits:nonnegative,acbUnits:nonnegative}),limitations:text
});
function weights(rows,field='percentOfPortfolio'){
  check(Math.abs(rows.reduce((n,r)=>n+r[field],0)-100)<=1);
  check(new Set(rows.map(r=>r.key)).size===rows.length);
}
const zero=Q.zero();
const sum=values=>values.reduce((a,b)=>a.add(b),zero);
const fractionQ=value=>new Q(BigInt(value.n),BigInt(value.d));
const units=value=>value.fixed(12).replace(/\.?0+$/,'');
const taxDisplay=value=>{
  const rounded=value.fixed(2); // Q suppresses a minus sign when rounding to zero.
  return rounded.startsWith('-')?'-CA$'+rounded.slice(1):'CA$'+rounded;
};
function validateTaxCalculations(t){
  const {purchases,sale}=t.calculationInputs;
  const quantities=purchases.map(p=>Q.of(p.quantity));
  const costs=purchases.map((p,i)=>quantities[i].mul(Q.of(p.unitPrice)).add(Q.of(p.fee)));
  const totalUnits=sum(quantities),cost=sum(costs),average=cost.div(totalUnits);
  const quantity=Q.of(sale.quantity),price=Q.of(sale.unitPrice),fee=Q.of(sale.fee);
  const seller=purchases.findIndex(p=>p.accountId===sale.accountId);
  check(seller>=0&&quantity.cmp(quantities[seller])<=0&&fee.cmp(quantity.mul(price))<=0);
  const proceeds=quantity.mul(price).sub(fee),allocated=average.mul(quantity);
  const remaining=totalUnits.sub(quantity);
  for(const [i,p] of purchases.entries()){
    const a=t.accounts[i];
    check(p.accountId===a.accountId&&p.date===t.timeline[i].date&&p.date<=sale.date);
    check(a.label==='Taxable account '+a.letter);
    check(a.cost===taxDisplay(costs[i]));
    check(a.pct===Number(costs[i].div(cost).mul(Q.of('100')).fixed(1)));
    check(a.detail===units(quantities[i])+' shares × '+taxDisplay(Q.of(p.unitPrice)));
    // Check the entire description, including appended prose. Free text must
    // never introduce accounting claims beside a verified CALCULATED result.
    check(t.timeline[i].title==='Buy in Account '+a.letter);
    check(t.timeline[i].detail===units(quantities[i])+' shares × '+taxDisplay(Q.of(p.unitPrice))+
      '; added '+taxDisplay(costs[i])+' to pooled ACB.');
  }
  check(t.before.units===units(totalUnits)&&t.before.cost===taxDisplay(cost)&&t.before.average===taxDisplay(average));
  check(t.after.units===units(remaining)&&t.after.cost===taxDisplay(cost.sub(allocated)));
  check(t.after.average===(remaining.cmp(zero)===0?'—':taxDisplay(average)));
  check(t.sale.quantity===units(quantity)&&t.sale.accountLetter===t.accounts[seller].letter&&t.sale.date===sale.date);
  check(t.sale.unitPrice===taxDisplay(price)&&t.sale.proceeds===taxDisplay(proceeds));
  check(t.sale.allocatedAcb===taxDisplay(allocated)&&t.sale.preliminaryGain===taxDisplay(proceeds.sub(allocated)));
  check(t.sale.accountOnlyGain===taxDisplay(proceeds.sub(quantity.mul(costs[seller].div(quantities[seller])))));
  const feeExplanation=fee.cmp(zero)===0?'':' − '+taxDisplay(fee)+' selling fee';
  check(t.sale.accountOnlyFormula==='Gross sale proceeds − selling account proportional purchase cost'+
    feeExplanation+' (unpooled assumption; exact values rounded once for display)');
  check(t.sale.pooledFormula==='Gross sale proceeds − proportional pooled ACB'+
    feeExplanation+' (exact values rounded once for display)');
  check(t.timeline[2].date===sale.date&&t.timeline[2].title==='Sell from Account '+t.accounts[seller].letter);
  check(t.timeline[2].detail===units(quantity)+' shares sold; '+allocated.fixed(2)+' CAD pooled cost allocated.');
}
function validateValuation(h){
  const evidence=h.valuationInputs,exactPositions=new Map();
  check(sameIds(evidence.accounts.map(a=>a.accountId),h.selectedAccountIds));
  check(evidence.positions.length===h.positions.length);
  for(const p of evidence.positions){
    const key=p.accountId+':'+p.securityId;
    check(!exactPositions.has(key));exactPositions.set(key,fractionQ(p.marketValue));
  }
  const totals={CAD:zero,USD:zero};
  for(const currency of ['CAD','USD']){
    const cashes=[],markets=[];
    for(const a of evidence.accounts){
      const pocket=a[currency],display=h.perAccount.find(p=>p.id===a.accountId).pockets[currency];
      const cash=fractionQ(pocket.cash),market=fractionQ(pocket.positionValue);
      const values=h.positions.filter(p=>p.accountId===a.accountId&&p.currency===currency).map(p=>{
        const value=exactPositions.get(p.accountId+':'+p.securityId);
        check(value!==undefined&&value.cmp(zero)>0&&p.marketValueNative===value.fixed(2));return value;
      });
      check(sum(values).cmp(market)===0);
      check(display.cash===cash.fixed(2)&&display.positionValue===market.fixed(2)&&display.total===cash.add(market).fixed(2));
      cashes.push(cash);markets.push(market);
    }
    const cash=sum(cashes),market=sum(markets),display=h.currencyTotals[currency];
    totals[currency]=cash.add(market);
    check(display.cash===cash.fixed(2)&&display.positionValue===market.fixed(2)&&display.total===totals[currency].fixed(2));
  }
  const foreign=totals.USD.cmp(zero)>0,rate=h.fx?Q.of(h.fx.rate):null;
  const value=foreign?(rate?totals.CAD.add(totals.USD.mul(rate)):null):totals.CAD;
  check(h.valuationState===(value===null?'missing-fx':value.cmp(zero)===0?'empty':'valued'));
  check(h.cadEquivalent===(value===null?null:value.fixed(2)));
  for(const p of h.positions){
    const native=exactPositions.get(p.accountId+':'+p.securityId);
    const cad=p.currency==='CAD'?native:rate?native.mul(rate):null;
    check(p.marketValueCadEquivalent===(cad===null?null:cad.fixed(2)));
  }
}
export function validateJournalResponse(payload,{accountIds=null}={}){
  envelope(payload);
  const {holdings:h,overview:o,taxLab:t}=payload;
  for(const view of [h,o,t]){
    check(view.journalId===payload.journalId&&view.journalRevision===payload.journalRevision&&view.asOf===payload.asOf);
  }
  const options=h.accountOptions.map(a=>a.id),chosen=h.selectedAccountIds;
  ids(options);
  check(chosen.every(x=>options.includes(x))&&h.accountCount===chosen.length);
  if(accountIds!==null)ids(accountIds);
  check(sameIds(chosen,accountIds??options));
  check(sameIds(h.perAccount.map(a=>a.id),chosen));
  check(same(payload.selectionScope,h.selectionScope)&&same(payload.selectionScope,o.selectionScope));
  check(sameIds(payload.selectionScope.accountIds,chosen)&&sameIds(o.selectedAccountIds,chosen));
  for(const field of ['currencyTotals','cadEquivalent','valuationState','takeaway'])check(same(o[field],h[field]));
  check(same(o.exposureSummary,h.exposure?.diagnostics??null));
  for(const a of h.perAccount)check(same(h.accountOptions.find(x=>x.id===a.id),Object.fromEntries(Object.keys(accountFields).map(k=>[k,a[k]]))));
  const positions=new Set();
  for(const p of h.positions){
    const a=h.perAccount.find(x=>x.id===p.accountId),key=p.accountId+':'+p.securityId;
    check(a&&p.accountLabel===a.label&&p.accountType===a.type&&!positions.has(key)&&p.quoteAsOf===payload.asOf);
    check(p.kind!=='cdr'||p.currency==='CAD');positions.add(key);
  }
  if(h.fx)check(h.fx.asOf===payload.asOf);
  validateValuation(h);
  if(h.valuationState==='missing-fx')check(h.fx===null&&h.cadEquivalent===null&&h.exposure===null&&h.allocation===null&&h.takeaway.state==='unavailable');
  else{
    check(h.cadEquivalent!==null);
    if(h.valuationState==='empty')check(h.cadEquivalent==='0.00'&&h.exposure===null&&h.allocation===null&&h.takeaway.state==='empty'&&h.positions.length===0);
    else check(h.exposure!==null&&h.allocation!==null&&['review','routine'].includes(h.takeaway.state));
  }
  if(h.exposure){
    const e=h.exposure;check(e.asOf===payload.asOf);
    for(const rows of Object.values(e.dimensions)){
      weights(rows);
      for(const row of rows)check(row.key==='cash'?row.percentOfInvested===null:row.percentOfInvested!==null);
    }
    const sector=e.dimensions.sector.filter(r=>r.key!=='cash');
    if(sector.length)weights(sector,'percentOfInvested');
    if(e.etfMix.length)weights(e.etfMix,'percentOfEtfs');
    weights(h.allocation.map(r=>({...r,key:r.kind})),'percent');
    for(const [key,dim] of [['largestSector','sector'],['largestGeography','geography']])
      check(same(e.diagnostics[key],e.dimensions[dim].find(r=>r.key!=='cash'&&r.key!=='unclassified')??null));
    if(e.exampleSectorComparison){check(e.exampleSectorComparison.asOf===payload.asOf);weights(e.exampleSectorComparison.rows,'targetPct');}
  }
  check(same(payload.taxScope,t.taxScope));
  check(payload.taxScope.ownerId==='SYN-OWNER-1'&&payload.taxScope.identicalPropertyId==='SYN-PROP-EQUITY-1');
  // Version 1 is deliberately the existing two-account educational tax case.
  check(sameIds(payload.taxScope.accountIds,['SYN-CAD-TAX','SYN-CAD-TAX-B']));
  check(sameIds(payload.taxScope.accountIds,t.accounts.map(a=>a.accountId)));
  check(new Set(t.accounts.map(a=>a.accountId)).size===2&&t.accounts[0].letter==='A'&&t.accounts[1].letter==='B');
  check(t.accounts.every(a=>h.accountOptions.find(x=>x.id===a.accountId)?.type==='taxable'));
  check(Math.abs(t.accounts.reduce((n,a)=>n+a.pct,0)-100)<=0.11);
  check(t.timeline.every(step=>step.date<=payload.asOf)&&t.timeline[2].date===t.sale.date);
  check(t.sale.date<=payload.asOf&&t.timeline[0].date<=t.timeline[1].date&&t.timeline[1].date<=t.sale.date);
  check(payload.reconciliation.acbUnits===t.after.units&&payload.reconciliation.taxableUnits===t.after.units);
  const unitTicks=value=>{const [whole,fraction='']=value.split('.');return BigInt(whole)*10n**12n+BigInt(fraction.padEnd(12,'0'));};
  check(unitTicks(t.before.units)-unitTicks(t.sale.quantity)===unitTicks(t.after.units));
  check((unitTicks(t.after.units)===0n)===(t.after.average==='—'));
  validateTaxCalculations(t);
  return payload;
}
export class InvalidAccountSelection extends Error {}
export const SELECTION_KEY='atlas-synthetic-account-selection-v1';
export function readSavedAccountSelection(getStorage,{fallback=null}={}){
  let raw;
  // Resolve the browser property inside the guard: its getter may itself throw.
  try{raw=(typeof getStorage==='function'?getStorage():getStorage).getItem(SELECTION_KEY);}
  catch{return fallback===null?[]:fallback.slice();}
  if(raw===null)return fallback===null?null:fallback.slice();
  // Corrupt stored selections are neither "all accounts" nor outbound input.
  try{const selected=JSON.parse(raw);ids(selected);return selected;}
  catch{return [];}
}
export async function readJournalResponse(response,options={}){
  if(!response.ok){
    // A status alone cannot prove invalid selection: server/fixture errors must
    // remain temporary failures, and must never trigger an all-account retry.
    if(response.status===400&&options.accountIds!==null&&options.accountIds!==undefined){
      let error;
      try{error=await response.json();}catch{/* Unstructured failure is temporary. */}
      if(error?.schemaVersion===JOURNAL_SCHEMA_VERSION&&error.synthetic===true&&error.journalId===JOURNAL_ID&&
        error.code==='INVALID_ACCOUNT_SELECTION'&&same(error.requestedAccountIds,options.accountIds))
        throw new InvalidAccountSelection('Choose valid fictional accounts in Holdings. Your saved selection has been retained.');
    }
    throw Error('Synthetic journal request temporarily unavailable');
  }
  return validateJournalResponse(await response.json(),options);
}
