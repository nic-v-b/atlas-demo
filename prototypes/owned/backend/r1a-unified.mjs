// R1a read-only projection from ONE fictional event journal.
// The demo server constructs its own journal; this module has no file,
// network, persistence, credential, telemetry, or external-agent access.
import {Q} from '../accounting/rational.mjs';
import {createHash} from 'node:crypto';
import {JOURNAL_SCHEMA_VERSION} from '../web/journal-response.mjs';
import {calculateSyntheticHoldings} from './holdings.mjs';
import {buildSyntheticTaxLabView} from './tax-lab-view.mjs';
import {
  getUnifiedSyntheticJournal,R1A_JOURNAL_ID,R1A_TAX_SECURITY,
  R1A_TAX_OWNER,R1A_TAX_PROPERTY
} from './r1a-journal.mjs';

const ZERO=Q.zero();
function taxSourceFromJournal(journal){
  const accounts=journal.accounts.filter(a=>a.ownerId===R1A_TAX_OWNER);
  const security=journal.securities.find(s=>s.id===R1A_TAX_SECURITY);
  if(!security||security.identicalPropertyId!==R1A_TAX_PROPERTY)
    throw Error('Canonical tax property identity changed');
  const taxableIds=new Set(accounts.filter(a=>a.type==='taxable').map(a=>a.id));
  const securitiesById=new Map(journal.securities.map(s=>[s.id,s]));
  // Every buy/sell in the same owner's taxable accounts must carry an
  // explicit, syntactically valid property identity BEFORE selecting the
  // educational ACB scope. Otherwise an unknown alias could disappear from
  // both tax-source selection and reconciliation and falsely report a match.
  // Check historical events, not just currently open positions; a round-trip
  // alias trade can affect the pooled ACB even if it ends at zero units.
  for(const event of journal.events){
    if((event.type!=='buy'&&event.type!=='sell')||
       !taxableIds.has(event.accountId))continue;
    const identity=securitiesById.get(event.securityId)?.identicalPropertyId;
    if(typeof identity!=='string'||!/^SYN-[A-Z0-9-]{2,64}$/.test(identity))
      throw Error('Missing or invalid identical-property identity for owner taxable trade; ACB reconciliation unavailable');
  }
  // This R1a educational view supports one custody instrument, not arbitrary
  // aliases with the same Canadian identical-property identity. Never silently
  // exclude their taxable activity and then certify an incomplete ACB pool.
  const propertyIds=new Set(journal.securities
    .filter(s=>s.identicalPropertyId===R1A_TAX_PROPERTY).map(s=>s.id));
  const propertyTrades=journal.events.filter(e=>
    (e.type==='buy'||e.type==='sell')&&taxableIds.has(e.accountId)&&
    propertyIds.has(e.securityId));
  if(propertyTrades.some(e=>e.securityId!==security.id))
    throw Error('Unsupported taxable identical-property alias activity; scoped R1a Tax Lab cannot reconcile this journal');
  const events=propertyTrades;
  return {synthetic:true,accounts,securities:[{
    id:security.id,identicalPropertyId:security.identicalPropertyId,
    currency:security.currency,kind:security.kind
  }],events};
}
function verifyCustody(journal,allHoldings,tax){
  // Tax-cost pooling is distinct from account custody. Their UNIT quantities
  // must nevertheless reconcile across the eligible taxable accounts.
  const allowed=new Set(journal.accounts.filter(a=>
    a.ownerId===R1A_TAX_OWNER&&a.type==='taxable').map(a=>a.id));
  const propertyIds=new Set(journal.securities
    .filter(s=>s.identicalPropertyId===R1A_TAX_PROPERTY).map(s=>s.id));
  const custody=allHoldings.positions.filter(p=>
    propertyIds.has(p.securityId)&&allowed.has(p.accountId))
    .reduce((sum,p)=>sum.add(Q.of(p.quantity)),ZERO);
  if(custody.cmp(Q.of(tax.after.units))!==0)
    throw Error('Shared journal: taxable custody and ACB units disagree');
  return {taxableUnits:tax.after.units,acbUnits:tax.after.units,matched:true};
}

export function buildUnifiedSyntheticViews(
  journal=getUnifiedSyntheticJournal(),{accountIds=null}={}
){
  if(journal?.synthetic!==true)
    throw Error('R1a accepts only a fictional journal');
  const allHoldings=calculateSyntheticHoldings(journal);
  const holdings=accountIds===null?allHoldings:
    calculateSyntheticHoldings(journal,{accountIds});
  const taxLab=buildSyntheticTaxLabView(taxSourceFromJournal(journal));
  const reconciliation=verifyCustody(journal,allHoldings,taxLab);
  // Content revision ties every projection to this exact in-memory fixture.
  // It is a consistency marker, not a signature or authenticity guarantee.
  const metadata={journalId:R1A_JOURNAL_ID,asOf:journal.asOf,
    journalRevision:createHash('sha256').update(JSON.stringify(journal)).digest('hex')};
  const selectionScope={kind:'selected-accounts',accountIds:holdings.selectedAccountIds};
  const taxScope={kind:'owner-taxable-property',ownerId:R1A_TAX_OWNER,
    identicalPropertyId:R1A_TAX_PROPERTY,accountIds:taxLab.accounts.map(a=>a.accountId)};
  return {
    schemaVersion:JOURNAL_SCHEMA_VERSION,synthetic:true,...metadata,selectionScope,taxScope,
    overview:{
      ...metadata,selectionScope,
      synthetic:true,asOf:holdings.asOf,journalId:R1A_JOURNAL_ID,
      selectedAccountIds:holdings.selectedAccountIds,
      currencyTotals:holdings.currencyTotals,
      cadEquivalent:holdings.cadEquivalent,
      valuationState:holdings.valuationState,
      takeaway:holdings.takeaway,
      exposureSummary:holdings.exposure?.diagnostics??null
    },
    holdings:{...holdings,...metadata,selectionScope},
    taxLab:{
      ...taxLab,...metadata,taxScope,
      scope:'All fictional eligible taxable accounts for one owner; independent of Holdings filters'
    },
    reconciliation,
    limitations:'Single fictional journal; no storage, importer, verified historical returns or certified tax result'
  };
}
