import { Q } from './rational.mjs';

// Independent, educational, SYNTHETIC-ONLY Canadian taxable-ACB oracle.
// No Wealthfolio code, network, filesystem access, persistence, or tax filing.
// Supported: buy/sell; identical-property, same-owner taxable ACB pooling.
// NOT supported: superficial loss amount/denial, ROC/DRIP, transfers, corporate
// actions, CDR hedge ratios, foreign-currency cash balances or tax inclusion rates.
const ZERO = Q.zero();
const q = x => Q.of(x);
const positive = (v,label) => {
  const n=q(v);
  if (n.cmp(ZERO)<=0) throw Error(label+' must be positive');
  return n;
};
const nonnegative = (v,label) => {
  const n=q(v);
  if (n.cmp(ZERO)<0) throw Error(label+' cannot be negative');
  return n;
};
const requireSynId = (v,label) => {
  if(typeof v!=='string'|| !/^SYN-[A-Z0-9-]{2,64}$/.test(v)) throw Error('Synthetic '+label+' required');
  return v;
};
const parseDay = date => {
  if(typeof date!=='string'|| !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid ISO calendar date');
  const y=Number(date.slice(0,4)),m=Number(date.slice(5,7)),d=Number(date.slice(8,10));
  const n=Date.UTC(y,m-1,d);
  if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==date) throw Error('Invalid ISO calendar date');
  return n/86400000;
};
const sameGroupKey=(ownerId,identicalPropertyId)=>JSON.stringify([ownerId,identicalPropertyId]);
function toCad(amount,currency,fxToCad) {
  if(currency==='CAD'){
    if(fxToCad!==undefined&&q(fxToCad).cmp(q('1'))!==0) throw Error('CAD cannot use non-unit FX');
    return amount;
  }
  if(currency!=='USD') throw Error('Currency not supported');
  return amount.mul(positive(fxToCad,'Explicit USD-to-CAD transaction-day FX'));
}
const get = (map,key)=> map.get(key)??ZERO;
function change(map,key,value) { map.set(key,value); }
function publicQ(v) { return v.fixed(2); }
// Exact accepted unit quantities are decimal with <=12 fractional places.
// Preserve them in machine-readable output; 4-decimal UI rounding would
// silently turn valid fractional custody into a false zero.
function publicUnits(v) {
  const [whole, fractional]=v.fixed(12).split('.');
  return whole+'.'+fractional.replace(/0+$/,'').padEnd(4,'0');
}
const ALLOWED_EVENT_FIELDS=new Set([
  'id','date','seq','type','accountId','securityId','currency',
  'quantity','unitPrice','fee','fxToCad'
]);
function lossCandidates(sale, allEvents, accounts, securities) {
  const saleAccount=accounts.get(sale.accountId);
  const group=securities.get(sale.securityId).identicalPropertyId;
  const day=parseDay(sale.date);
  const near=[];
  for(const e of allEvents){
    if(e.type!=='buy'||!securities.has(e.securityId)||securities.get(e.securityId).identicalPropertyId!==group) continue;
    const other=accounts.get(e.accountId);
    const delta=parseDay(e.date)-day;
    if(Math.abs(delta)>30) continue;
    if(other.ownerId===saleAccount.ownerId || (other.affiliationGroupId===saleAccount.affiliationGroupId)){
      near.push({eventId:e.id, accountId:other.id, daysFromSale:delta, accountType:other.type});
    }
  }
  return {
    status:'REVIEW_REQUIRED',
    nearAcquisitions:near,
    note:'Candidate window only; does not determine continued holdings on day +30, loss denial, or eventual ACB treatment. Other affiliated holdings may be missing.'
  };
}
export function calculateSyntheticTaxableAcb(scenario) {
  if(!scenario || scenario.synthetic!==true) throw Error('Synthetic-only input required');
  if(!Array.isArray(scenario.accounts)|| !Array.isArray(scenario.securities)|| !Array.isArray(scenario.events)) {
    throw Error('Accounts, securities and events arrays required');
  }
  const accounts=new Map(), securities=new Map(), byGroup=new Map();
  for(const a of scenario.accounts){
    requireSynId(a.id,'account ID'); requireSynId(a.ownerId,'owner ID');
    requireSynId(a.affiliationGroupId,'affiliation group ID');
    if(accounts.has(a.id)||!['taxable','tfsa','rrsp'].includes(a.type)) throw Error('Invalid or duplicate account');
    accounts.set(a.id,a);
  }
  for(const s of scenario.securities){
    requireSynId(s.id,'security ID');requireSynId(s.identicalPropertyId,'property identity');
    if(securities.has(s.id)||!['CAD','USD'].includes(s.currency)||!['equity','fund','cdr'].includes(s.kind)) {
      throw Error('Invalid or duplicate security');
    }
    // Security / underlying linkage is not presumed to imply CRA identical property.
    const prev=byGroup.get(s.identicalPropertyId);
    if(prev && (prev.currency!==s.currency||prev.kind!==s.kind)){
      throw Error('Conflicting security identity needs explicit review');
    }
    if(s.kind==='cdr'&&s.currency!=='CAD') throw Error('CDR fixture needs independent CAD denomination');
    byGroup.set(s.identicalPropertyId,s);
    securities.set(s.id,s);
  }
  const unitsByAccount=new Map(), unitsByAccountSecurity=new Map(), pools=new Map(), dispositions=[], seen=new Set();
  let lastDay=-Infinity,lastSeq=-1;
  for(const e of scenario.events){
    // This prototype assumes fees use the activity currency, date and FX.
    // Explicitly reject alternate fee metadata (and other unsupported fields)
    // instead of silently treating CAD-denominated fees as USD, for example.
    for(const key of Object.keys(e)){
      if(!ALLOWED_EVENT_FIELDS.has(key)) throw Error('Unsupported transaction metadata: '+key);
    }
    requireSynId(e.id,'event ID');
    if(seen.has(e.id)||!['buy','sell'].includes(e.type)) throw Error('Duplicate event or unsupported event type');
    seen.add(e.id);
    const day=parseDay(e.date);
    if(!Number.isSafeInteger(e.seq)||e.seq<0||day<lastDay||(day===lastDay&&e.seq<=lastSeq)) {
      throw Error('Events must be date/sequence ordered, no ambiguous same-day ties');
    }
    lastDay=day;lastSeq=e.seq;
    const account=accounts.get(e.accountId),security=securities.get(e.securityId);
    if(!account||!security) throw Error('Unknown account/security');
    if(e.currency!==security.currency) throw Error('Activity currency differs from security denomination');
    const quantity=positive(e.quantity,'Unit count'), price=positive(e.unitPrice,'Unit price');
    const fee=nonnegative(e.fee??'0','Fee');
    const grossCad=toCad(quantity.mul(price),e.currency,e.fxToCad);
    const feeCad=toCad(fee,e.currency,e.fxToCad);
    const ak=JSON.stringify([account.id,security.identicalPropertyId]);
    const sk=JSON.stringify([account.id,security.id]);
    const oldUnits=get(unitsByAccount,ak);
    const oldSecurityUnits=get(unitsByAccountSecurity,sk);
    const isTaxable=account.type==='taxable';
    const poolKey=sameGroupKey(account.ownerId,security.identicalPropertyId);
    const pool=pools.get(poolKey)??{
      ownerId:account.ownerId,identicalPropertyId:security.identicalPropertyId,
      units:ZERO,acb:ZERO,unresolvedLossEventIds:[]
    };
    if(e.type==='buy'){
      change(unitsByAccount,ak,oldUnits.add(quantity));
      change(unitsByAccountSecurity,sk,oldSecurityUnits.add(quantity));
      if(isTaxable){
        pool.units=pool.units.add(quantity);
        pool.acb=pool.acb.add(grossCad.add(feeCad));
        pools.set(poolKey,pool);
      }
    }else{
      // Tax-equivalent securities can share ACB, but not fungible custody.
      // Without an explicit conversion/transfer, cannot sell an instrument
      // merely because this account holds a different security in its tax pool.
      if(oldSecurityUnits.cmp(quantity)<0) throw Error('Cannot sell more units of this security than held in selling account');
      if(oldUnits.cmp(quantity)<0) throw Error('Cannot sell more units than held in selling account');
      change(unitsByAccount,ak,oldUnits.sub(quantity));
      change(unitsByAccountSecurity,sk,oldSecurityUnits.sub(quantity));
      if(isTaxable){
        if(pool.units.cmp(quantity)<0) throw Error('Taxable pool inconsistent with account units');
        const allocated=pool.acb.mul(quantity).div(pool.units);
        const gain=grossCad.sub(feeCad).sub(allocated);
        pool.units=pool.units.sub(quantity);
        pool.acb=pool.acb.sub(allocated);
        if(pool.units.cmp(ZERO)===0) pool.acb=ZERO;
        pools.set(poolKey,pool);
        const loss=gain.cmp(ZERO)<0;
        const priorUnresolvedLossEventIds=[...pool.unresolvedLossEventIds];
        // A sale with an actual preliminary loss is review-required.
        // If the pool already carries an unresolved loss/basis dependency,
        // even an apparent gain may become a loss after basis correction.
        // Propagate these *uncertainty warnings* to affiliated taxable
        // replacement-owner pools through candidate acquisitions within
        // +/-30 days. This is a conservative screening dependency graph,
        // not a finding of legal superficial loss or an ACB adjustment.
        // Never mix holdings, ownership, or numerical ACB across owners.
        const uncertainSale=loss||priorUnresolvedLossEventIds.length>0;
        const candidateReview=uncertainSale
          ? lossCandidates(e,scenario.events,accounts,securities):null;
        if(uncertainSale){
          // Maintain upstream root-loss provenance through subsequent
          // possibly affected gains. New preliminary losses also become
          // roots; do not relabel an apparent gain as a realized loss.
          const sourceLossEventIds=loss
            ? [...priorUnresolvedLossEventIds,e.id]
            : priorUnresolvedLossEventIds;
          if(loss && !pool.unresolvedLossEventIds.includes(e.id)){
            pool.unresolvedLossEventIds.push(e.id);
          }
          for(const candidate of candidateReview.nearAcquisitions){
            const replacementAccount=accounts.get(candidate.accountId);
            if(replacementAccount.type!=='taxable' || replacementAccount.ownerId===account.ownerId) continue;
            const replacementKey=sameGroupKey(replacementAccount.ownerId,security.identicalPropertyId);
            const replacementPool=pools.get(replacementKey)??{
              ownerId:replacementAccount.ownerId,identicalPropertyId:security.identicalPropertyId,
              units:ZERO,acb:ZERO,unresolvedLossEventIds:[]
            };
            for(const sourceId of sourceLossEventIds){
              if(!replacementPool.unresolvedLossEventIds.includes(sourceId)){
                replacementPool.unresolvedLossEventIds.push(sourceId);
              }
            }
            pools.set(replacementKey,replacementPool);
          }
        }
        const basisReview=pool.unresolvedLossEventIds.length ? {
          status:'REVIEW_REQUIRED',
          unresolvedLossEventIds:[...pool.unresolvedLossEventIds],
          note:'Preliminary ACB may depend on a previous loss decision; no loss-denial or replacement-ACB determination was performed.'
        } : null;
        const lossReview=loss
          ? {...candidateReview,priorUnresolvedLossEventIds}
          : (priorUnresolvedLossEventIds.length ? {
              status:'REVIEW_REQUIRED', reason:'PRIOR_LOSS_BASIS_UNRESOLVED',
              relatedLossEventIds:priorUnresolvedLossEventIds,
              note:'This sale may depend on the tax treatment of earlier loss sales, even if its preliminary result is a gain.'
            } : null);
        dispositions.push({
          eventId:e.id,accountId:account.id, ownerId:account.ownerId,
          identicalPropertyId:security.identicalPropertyId,
          quantity:publicUnits(quantity),proceedsCad:publicQ(grossCad),
          sellingFeesCad:publicQ(feeCad),allocatedAcbCad:publicQ(allocated),
          preliminaryGainOrLossCad:publicQ(gain),
          lossReview,basisReview,
          taxReady:false
        });
      }
    }
  }
  return {
    synthetic:true,taxReady:false,
    supported:'Same-owner taxable identical-property pool; buy/sell preliminary gain only',
    limitations:'Not CRA-certified; no superficial loss ruling, ROC, DRIP, corporate actions, cost basis transfers, withholding, taxes or foreign currency cash accounting',
    pools:[...pools.values()].map(p=>({
      ownerId:p.ownerId,identicalPropertyId:p.identicalPropertyId,
      units:publicUnits(p.units),acbCad:publicQ(p.acb),
      basisReviewStatus:p.unresolvedLossEventIds.length?'REVIEW_REQUIRED':'NO_KNOWN_LOSS_FLAGS',
      unresolvedLossEventIds:[...p.unresolvedLossEventIds],
      averageCad:p.units.cmp(ZERO)===0?null:p.acb.div(p.units).fixed(4)
    })),
    accountUnits:[...unitsByAccount].map(([key,units])=>({
      accountId:JSON.parse(key)[0],identicalPropertyId:JSON.parse(key)[1],units:publicUnits(units)
    })),
    // Separate per-instrument custody proof: a tax pool is not a tradable wallet.
    accountSecurityUnits:[...unitsByAccountSecurity].map(([key,units])=>({
      accountId:JSON.parse(key)[0],securityId:JSON.parse(key)[1],units:publicUnits(units)
    })),
    dispositions
  };
}
