import {Q} from '../accounting/rational.mjs';
import {calculateSyntheticTaxableAcb} from '../accounting/r0f-taxable-acb.mjs';
import {taxablePoolingFixture} from '../accounting/r0f-fixtures.mjs';

const q=x=>Q.of(x);
const money=x=>{
  const rounded=x.fixed(2); // Q suppresses a minus sign when rounding to zero.
  return rounded.startsWith('-')?'-CA$'+rounded.slice(1):'CA$'+rounded;
};
const share=x=>{
  // Unit custody is not currency: do not round fractional shares to integers.
  // Keep the original 12-decimal synthetic oracle precision, trimming zeroes
  // only for presentation (whole shares still display as "20").
  const [whole,fraction]=x.fixed(12).split('.');
  const significant=fraction.replace(/0+$/,'');
  return significant?whole+'.'+significant:whole;
};
const percent=x=>x.fixed(1)+'%';
// A deliberately narrow educational adapter, not a live tax/account endpoint.
// All numbers come from the same R0f fixture evaluated through the R0f oracle.
export function buildSyntheticTaxLabView(fixture=taxablePoolingFixture){
  if(!fixture||fixture.synthetic!==true)throw Error('Synthetic-only Tax Lab fixture');
  const result=calculateSyntheticTaxableAcb(fixture);
  const owner=fixture.accounts[0]?.ownerId;
  const prop=fixture.securities[0]?.identicalPropertyId;
  const accounts=new Map(fixture.accounts.map(a=>[a.id,a]));
  const securities=new Map(fixture.securities.map(s=>[s.id,s]));
  const purchases=fixture.events.filter(e=>e.type==='buy'&&accounts.get(e.accountId)?.ownerId===owner&&
    accounts.get(e.accountId)?.type==='taxable'&&securities.get(e.securityId)?.identicalPropertyId===prop);
  const sales=fixture.events.filter(e=>e.type==='sell'&&accounts.get(e.accountId)?.ownerId===owner&&
    accounts.get(e.accountId)?.type==='taxable'&&securities.get(e.securityId)?.identicalPropertyId===prop);
  if(purchases.length!==2||sales.length!==1||purchases[0].accountId===purchases[1].accountId||
     purchases.some(e=>e.currency!=='CAD')||sales[0].currency!=='CAD') {
    throw Error('Educational Tax Lab requires exactly two CAD purchases from different taxable accounts and one CAD sale');
  }
  const sale=sales[0],disposal=result.dispositions.find(d=>d.eventId===sale.id);
  const pool=result.pools.find(p=>p.ownerId===owner&&p.identicalPropertyId===prop);
  if(!disposal||!pool)throw Error('Missing deterministic ACB results');
  const purchaseCosts=purchases.map(e=>q(e.quantity).mul(q(e.unitPrice)).add(q(e.fee??'0')));
  const combinedQuantity=purchases.reduce((n,e)=>n.add(q(e.quantity)),Q.zero());
  const combinedCost=purchaseCosts.reduce((n,v)=>n.add(v),Q.zero());
  const average=combinedCost.div(combinedQuantity);
  const sellingQty=q(sale.quantity),sellingPrice=q(sale.unitPrice),sellingFee=q(sale.fee??'0');
  const proceeds=sellingQty.mul(sellingPrice).sub(sellingFee);
  const sellerBuy=purchases.find(e=>e.accountId===sale.accountId);
  const sellerCostPerShare=purchaseCosts[purchases.indexOf(sellerBuy)].div(q(sellerBuy.quantity));
  const naive=proceeds.sub(sellingQty.mul(sellerCostPerShare));
  const expected=proceeds.sub(sellingQty.mul(average));
  if(expected.fixed(2)!==disposal.preliminaryGainOrLossCad){
    throw Error('Tax Lab independent derivation disagrees with R0f oracle');
  }
  const feeExplanation=sellingFee.cmp(Q.zero())===0?'':' − '+money(sellingFee)+' selling fee';
  const accountsView=purchases.map((e,i)=>({
    letter:i===0?'A':'B',
    accountId:e.accountId,
    label:i===0?'Taxable account A':'Taxable account B',
    detail:share(q(e.quantity))+' shares × '+money(q(e.unitPrice)),
    cost:money(purchaseCosts[i]),
    pct:Number(purchaseCosts[i].div(combinedCost).mul(q('100')).fixed(1))
  }));
  const afterQty=q(pool.units),afterCost=q(pool.acbCad);
  const input=e=>({accountId:e.accountId,date:e.date,quantity:e.quantity,unitPrice:e.unitPrice,fee:e.fee??'0'});
  // This educational case has exactly two buys and one sale. Removing
  // proportional ACB cannot change the per-unit average. Cross-check the
  // oracle's 4dp report, but round the ORIGINAL exact fraction to cents once.
  // Converting oracle 4dp back to Q then rounding again can shift the
  // displayed average by one cent at a half-cent boundary.
  if(afterQty.cmp(Q.zero())>0&&pool.averageCad!==average.fixed(4)){
    throw Error('Educational average disagrees with the exact-rational ACB oracle');
  }
  return {
    synthetic:true,taxReady:false,
    source:'R0f exact-rational synthetic ACB oracle',
    calculationInputs:{purchases:purchases.map(input),sale:input(sale)},
    before:{units:share(combinedQuantity),cost:money(combinedCost),average:money(average)},
    after:{units:share(afterQty),cost:money(afterCost),
      average:afterQty.cmp(Q.zero())===0?'—':money(average)},
    accounts:accountsView,
    sale:{
      quantity:share(sellingQty),
      accountLetter:accountsView.find(x=>x.accountId===sale.accountId)?.letter??'?',
      unitPrice:money(sellingPrice),
      proceeds:money(proceeds),
      allocatedAcb:money(q(disposal.allocatedAcbCad)),
      preliminaryGain:money(q(disposal.preliminaryGainOrLossCad)),
      accountOnlyGain:money(naive),
      // Rounded per-share averages need not reproduce an exact-rational gain.
      // Explain the calculation without implying rounded display inputs were used.
      accountOnlyFormula:'Gross sale proceeds − selling account proportional purchase cost'+feeExplanation+' (unpooled assumption; exact values rounded once for display)',
      pooledFormula:'Gross sale proceeds − proportional pooled ACB'+feeExplanation+' (exact values rounded once for display)',
      date:sale.date,
      lossReview:disposal.lossReview?.status??null
    },
    timeline:[
      ...purchases.map((e,i)=>({date:e.date,title:'Buy in Account '+accountsView[i].letter,
        detail:accountsView[i].detail+'; added '+accountsView[i].cost+' to pooled ACB.'})),
      {date:sale.date,title:'Sell from Account '+(accountsView.find(x=>x.accountId===sale.accountId)?.letter??'?'),
        detail:share(sellingQty)+' shares sold; '+disposal.allocatedAcbCad+' CAD pooled cost allocated.'}
    ],
    limitations:'Illustrative tax-cost comparison only; not deductible-loss or CRA filing determination'
  };
}
