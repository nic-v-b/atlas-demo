// R1a canonical SYNTHETIC event journal. Never import local financial files
// or accept client-supplied journal JSON through the demo HTTP server.
import {getHoldingsFixture} from './holdings-fixture.mjs';

export const R1A_JOURNAL_ID='SYN-R1A-CANONICAL';
export const R1A_TAX_SECURITY='SYN-EQUITY-1';
export const R1A_TAX_OWNER='SYN-OWNER-1';
export const R1A_TAX_PROPERTY='SYN-PROP-EQUITY-1';

export function getUnifiedSyntheticJournal(){
  const journal=getHoldingsFixture(); // A fresh, fabricated copy per request.
  for(const a of journal.accounts){
    a.affiliationGroupId='SYN-HOUSEHOLD-1';
  }
  for(const s of journal.securities){
    // Identical-property identity is explicit, not inferred from symbol or issuer.
    s.identicalPropertyId=s.id===R1A_TAX_SECURITY
      ?R1A_TAX_PROPERTY:'SYN-PROP-'+s.id.slice(4);
  }
  // The same purchase/sale events drive cash/custody and taxable ACB.
  journal.accounts.push({
    id:'SYN-CAD-TAX-B',ownerId:R1A_TAX_OWNER,
    affiliationGroupId:'SYN-HOUSEHOLD-1',
    label:'Fictional second taxable account',type:'taxable',currency:'CAD'
  });
  journal.events.push(
    {id:'SYN-R1A-CASH-B',date:'2026-01-05',seq:1,
      accountId:'SYN-CAD-TAX-B',type:'deposit',currency:'CAD',amount:'5000'},
    {id:'SYN-R1A-BUY-B',date:'2026-02-06',seq:1,
      accountId:'SYN-CAD-TAX-B',type:'buy',currency:'CAD',
      securityId:R1A_TAX_SECURITY,quantity:'10',unitPrice:'120',fee:'0'},
    {id:'SYN-R1A-SELL-A',date:'2026-03-03',seq:1,
      accountId:'SYN-CAD-TAX',type:'sell',currency:'CAD',
      securityId:R1A_TAX_SECURITY,quantity:'5',unitPrice:'150',fee:'2'}
  );
  journal.events.sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq);
  return journal;
}
