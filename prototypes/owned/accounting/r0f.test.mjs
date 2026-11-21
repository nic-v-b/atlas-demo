import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSyntheticTaxableAcb} from './r0f-taxable-acb.mjs';
import {taxablePoolingFixture,foreignCurrencyFixture,affiliatedLossFixture} from './r0f-fixtures.mjs';
const clone=x=>structuredClone(x);
const run=x=>calculateSyntheticTaxableAcb(x);
const pool=(r,ownerId,prop)=>r.pools.find(p=>p.ownerId===ownerId&&p.identicalPropertyId===prop);
const units=(r,accountId)=>r.accountUnits.find(p=>p.accountId===accountId).units;
test('same beneficial owner, identical security aliases: taxable accounts share one CAD ACB pool',()=>{
  const r=run(taxablePoolingFixture),p=pool(r,'SYN-OWNER-A','SYN-PROP-ONE');
  assert.deepEqual([p.units,p.acbCad,p.averageCad],['15.0000','450.00','30.0000']);
  assert.equal(r.dispositions[0].allocatedAcbCad,'150.00');
  assert.equal(r.dispositions[0].preliminaryGainOrLossCad,'0.00');
});
test('previous per-account weighted-cost would misstate realized taxable gain',()=>{
  const r=run(taxablePoolingFixture);
  assert.equal(r.dispositions[0].preliminaryGainOrLossCad,'0.00');
  assert.notEqual(r.dispositions[0].preliminaryGainOrLossCad,'50.00');
});
test('selling account still must own units: pooled holdings cannot permit overselling local account',()=>{
  const f=clone(taxablePoolingFixture);
  f.events[4].quantity='11';
  assert.throws(()=>run(f),/Cannot sell more units/);
});
test('TFSA holdings do not enter ordinary taxable same-owner pooled ACB',()=>{
  const r=run(taxablePoolingFixture),p=pool(r,'SYN-OWNER-A','SYN-PROP-ONE');
  assert.equal(p.averageCad,'30.0000');
  assert.equal(units(r,'SYN-TFSA-A'),'5.0000');
  assert.equal(r.dispositions.length,1);
});
test('different owners have separate taxable pools even if property class matches',()=>{
  const r=run(taxablePoolingFixture),p=pool(r,'SYN-OWNER-B','SYN-PROP-ONE');
  assert.deepEqual([p.units,p.acbCad,p.averageCad],['10.0000','100.00','10.0000']);
});
test('cannot sell a tax-identical alias that was never acquired in the selling account',()=>{
  const f=clone(taxablePoolingFixture);
  // B owns the alias, but A owns only SYN-SHARE-ONE: shared tax ACB
  // must NOT be misused to create a fictitious A-side custody sale.
  f.events[4].securityId='SYN-SHARE-ALIAS';
  assert.throws(()=>run(f),/Cannot sell more units of this security/);
});
test('different security aliases in same account share taxable ACB but keep distinct custody',()=>{
  const f=clone(taxablePoolingFixture);
  f.events.splice(4,0,{
    id:'SYN-E-ALIAS',date:'2026-01-06',seq:1,type:'buy',
    accountId:'SYN-TAX-A',securityId:'SYN-SHARE-ALIAS',
    currency:'CAD',quantity:'2',unitPrice:'30',fee:'0'
  });
  f.events[5].securityId='SYN-SHARE-ALIAS';
  f.events[5].quantity='2';
  const r=run(f),p=pool(r,'SYN-OWNER-A','SYN-PROP-ONE');
  assert.equal(r.dispositions[0].preliminaryGainOrLossCad,'0.00');
  assert.deepEqual([p.units,p.acbCad],['20.0000','600.00']);
  const a=r.accountSecurityUnits.filter(x=>x.accountId==='SYN-TAX-A');
  assert.equal(a.find(x=>x.securityId==='SYN-SHARE-ONE').units,'10.0000');
  assert.equal(a.find(x=>x.securityId==='SYN-SHARE-ALIAS').units,'0.0000');
});
test('foreign acquisition FX and sale FX are distinct and fees use transaction-day CAD',()=>{
  const r=run(foreignCurrencyFixture);
  assert.deepEqual(r.dispositions.map(d=>[d.proceedsCad,d.sellingFeesCad,d.allocatedAcbCad,d.preliminaryGainOrLossCad]),
    [['162.00','1.35','131.30','29.35']]);
  assert.deepEqual([r.pools[0].units,r.pools[0].acbCad],['1.0000','131.30']);
});
test('purchase commissions increase pooled ACB, sell commissions reduce gain',()=>{
  const f=clone(taxablePoolingFixture);
  f.events[0].fee='5';
  f.events[1].fee='10';
  const d=run(f).dispositions[0],p=run(f).pools[0];
  assert.equal(d.allocatedAcbCad,'153.75');
  assert.equal(d.preliminaryGainOrLossCad,'-3.75');
  assert.equal(p.acbCad,'461.25');
});
test('preliminary sale at loss produces review-required flag, not automatic deductible loss',()=>{
  const r=run(affiliatedLossFixture),d=r.dispositions[0];
  assert.equal(d.preliminaryGainOrLossCad,'-50.00');
  assert.equal(d.taxReady,false);
  assert.equal(d.lossReview.status,'REVIEW_REQUIRED');
  assert.equal(d.lossReview.nearAcquisitions.length,3);
  assert.ok(d.lossReview.nearAcquisitions.some(e=>e.accountType==='tfsa' &&e.daysFromSale===1));
  assert.ok(d.lossReview.nearAcquisitions.some(e=>e.accountId==='SYN-SPOUSE-LOSS'&&e.daysFromSale===5));
});
test('affiliated-person account is flagged but never pooled with different beneficial owner',()=>{
  const r=run(affiliatedLossFixture);
  const a=pool(r,'SYN-OWNER-L','SYN-LOSS-PROP');
  const spouse=pool(r,'SYN-OWNER-S','SYN-LOSS-PROP');
  assert.equal(a.acbCad,'150.00');
  assert.equal(spouse.acbCad,'20.00');
});
test('loss remains review-required with incomplete or empty reacquisition history',()=>{
  const f=clone(affiliatedLossFixture);
  f.events=f.events.slice(0,2);
  const d=run(f).dispositions[0];
  assert.equal(d.lossReview.status,'REVIEW_REQUIRED');
  assert.equal(d.lossReview.nearAcquisitions.length,1);
  assert.equal(d.taxReady,false);
});
test('reject missing historical transaction FX rather than assume USD equals CAD',()=>{
  const f=clone(foreignCurrencyFixture);
  delete f.events[0].fxToCad;
  assert.throws(()=>run(f),/Amounts must be finite decimal strings/);
});
test('reject incompatible same-property currency/kind metadata (CDR vs ordinary shares)',()=>{
  const f=clone(taxablePoolingFixture);
  f.securities[1].kind='cdr';
  assert.throws(()=>run(f),/Conflicting security identity/);
});
test('do not infer that a CAD-listed CDR is identical to its underlying USD share',()=>{
  const f=clone(taxablePoolingFixture);
  f.securities.push({id:'SYN-CDR-SEC',identicalPropertyId:'SYN-CDR-PROP',currency:'CAD',kind:'cdr'});
  f.events.push({id:'SYN-E6',date:'2026-03-01',seq:1,type:'buy',accountId:'SYN-TAX-A',
    securityId:'SYN-CDR-SEC',currency:'CAD',quantity:'2',unitPrice:'10'});
  const r=run(f);
  assert.equal(pool(r,'SYN-OWNER-A','SYN-CDR-PROP').acbCad,'20.00');
  assert.equal(pool(r,'SYN-OWNER-A','SYN-PROP-ONE').acbCad,'450.00');
});
test('reject event sequence ties and out-of-order dates',()=>{
  const f=clone(taxablePoolingFixture);
  f.events[1].date=f.events[0].date;
  f.events[1].seq=f.events[0].seq;
  assert.throws(()=>run(f),/date\/sequence ordered/);
  const g=clone(taxablePoolingFixture);
  g.events[1].date='2025-12-31';
  assert.throws(()=>run(g),/date\/sequence ordered/);
});
test('reject invalid calendar date, negative fee and unsupported transaction',()=>{
  const f=clone(taxablePoolingFixture);f.events[0].date='2026-02-30';
  assert.throws(()=>run(f),/Invalid ISO calendar date/);
  const g=clone(taxablePoolingFixture);g.events[0].fee='-1';
  assert.throws(()=>run(g),/Fee cannot be negative/);
  const h=clone(taxablePoolingFixture);h.events[0].type='roc';
  assert.throws(()=>run(h),/unsupported event type/);
});
test('reject inputs lacking explicit synthetic marker and synthetic IDs',()=>{
  assert.throws(()=>run({...taxablePoolingFixture,synthetic:false}),/Synthetic-only input/);
  const f=clone(taxablePoolingFixture);
  f.accounts[0].id='actual-bank';
  assert.throws(()=>run(f),/Synthetic account ID/);
});
test('tax engine cannot claim completed return / tax certification',()=>{
  const r=run(taxablePoolingFixture);
  assert.equal(r.synthetic,true);assert.equal(r.taxReady,false);
  assert.ok(r.dispositions.every(d=>d.taxReady===false));
  assert.equal(r.capitalGainsTaxCAD,undefined);
});


test('subsequent apparent gain remains under review when an earlier loss may alter replacement ACB',()=>{
  const f={
    synthetic:true,
    accounts:[{id:'SYN-TAX-CHAIN',ownerId:'SYN-OWNER-CHAIN',affiliationGroupId:'SYN-FAMILY-CHAIN',type:'taxable'}],
    securities:[{id:'SYN-STOCK-CHAIN',identicalPropertyId:'SYN-PROP-CHAIN',currency:'CAD',kind:'equity'}],
    events:[
      {id:'SYN-CHAIN-1',date:'2026-01-01',seq:1,type:'buy',accountId:'SYN-TAX-CHAIN',securityId:'SYN-STOCK-CHAIN',currency:'CAD',quantity:'10',unitPrice:'30'},
      {id:'SYN-CHAIN-2',date:'2026-12-01',seq:1,type:'sell',accountId:'SYN-TAX-CHAIN',securityId:'SYN-STOCK-CHAIN',currency:'CAD',quantity:'10',unitPrice:'20'},
      {id:'SYN-CHAIN-3',date:'2026-12-02',seq:1,type:'buy',accountId:'SYN-TAX-CHAIN',securityId:'SYN-STOCK-CHAIN',currency:'CAD',quantity:'10',unitPrice:'20'},
      {id:'SYN-CHAIN-4',date:'2027-02-01',seq:1,type:'sell',accountId:'SYN-TAX-CHAIN',securityId:'SYN-STOCK-CHAIN',currency:'CAD',quantity:'10',unitPrice:'25'}
    ]
  };
  const r=run(f);
  assert.equal(r.dispositions[0].preliminaryGainOrLossCad,'-100.00');
  assert.equal(r.dispositions[0].lossReview.status,'REVIEW_REQUIRED');
  assert.equal(r.dispositions[1].preliminaryGainOrLossCad,'50.00');
  assert.equal(r.dispositions[1].lossReview.status,'REVIEW_REQUIRED');
  assert.equal(r.dispositions[1].lossReview.reason,'PRIOR_LOSS_BASIS_UNRESOLVED');
  assert.deepEqual(r.dispositions[1].basisReview.unresolvedLossEventIds,['SYN-CHAIN-2']);
  assert.equal(r.dispositions[1].taxReady,false);
  assert.equal(r.pools[0].basisReviewStatus,'REVIEW_REQUIRED');
  assert.deepEqual(r.pools[0].unresolvedLossEventIds,['SYN-CHAIN-2']);
});

test('machine-readable unit precision does not erase valid fractional custody',()=>{
  const f=clone(taxablePoolingFixture);
  f.events=[{id:'SYN-FRAC-1',date:'2026-02-01',seq:1,type:'buy',
    accountId:'SYN-TAX-A',securityId:'SYN-SHARE-ONE',currency:'CAD',
    quantity:'0.00004',unitPrice:'100000',fee:'0'}];
  const r=run(f);
  assert.equal(r.pools[0].units,'0.00004');
  assert.equal(r.accountUnits[0].units,'0.00004');
  assert.equal(r.accountSecurityUnits[0].units,'0.00004');
  assert.equal(r.pools[0].acbCad,'4.00');
  f.events.push({id:'SYN-FRAC-2',date:'2026-02-02',seq:1,type:'sell',
    accountId:'SYN-TAX-A',securityId:'SYN-SHARE-ONE',currency:'CAD',
    quantity:'0.00001',unitPrice:'100000',fee:'0'});
  const after=run(f);
  assert.equal(after.accountSecurityUnits[0].units,'0.00003');
  assert.equal(after.dispositions[0].quantity,'0.00001');
  assert.equal(after.pools[0].units,'0.00003');
});

test('smallest permitted fractional custody survives serialization without binary floating point',()=>{
  const f=clone(taxablePoolingFixture);
  f.events=[{id:'SYN-TINY-1',date:'2026-02-01',seq:1,type:'buy',
    accountId:'SYN-TAX-A',securityId:'SYN-SHARE-ONE',currency:'CAD',
    quantity:'0.000000000001',unitPrice:'1000000000000'}];
  const r=run(f);
  assert.equal(r.accountUnits[0].units,'0.000000000001');
  assert.equal(r.accountSecurityUnits[0].units,'0.000000000001');
  assert.equal(r.pools[0].units,'0.000000000001');
  assert.equal(r.pools[0].acbCad,'1.00');
});

test('reject alternative fee currencies, fee dates, conversion rates and unknown metadata',()=>{
  const variations=[
    {feeCurrency:'CAD'},{feeDate:'2026-02-19'},
    {feeFxToCad:'1.33'},{feeFxRate:'1.33'},
    {unsupportedSettlementCurrency:'CAD'}
  ];
  for(const extra of variations){
    const f=clone(foreignCurrencyFixture);
    Object.assign(f.events[1],extra);
    assert.throws(()=>run(f),/Unsupported transaction metadata/);
  }
  assert.deepEqual(run(foreignCurrencyFixture).dispositions[0].preliminaryGainOrLossCad,'29.35');
});


// Affiliated-owner loss dependencies are review flags only; NEVER pooled ACB.
const affiliatedReplacementScenario=({replacementDate='2026-03-15',affiliated=true}={})=>{
  const s={
    synthetic:true,
    accounts:[
      {id:'SYN-SELLER-TAX',ownerId:'SYN-SELLER',affiliationGroupId:'SYN-FAMILY-ONE',type:'taxable'},
      {id:'SYN-BUYER-TAX',ownerId:'SYN-BUYER',affiliationGroupId:affiliated?'SYN-FAMILY-ONE':'SYN-UNRELATED',type:'taxable'}
    ],
    securities:[{id:'SYN-PROPERTY',identicalPropertyId:'SYN-IDENTICAL',currency:'CAD',kind:'equity'}],
    events:[
      {id:'SYN-SELLER-BUY',date:'2026-03-01',seq:1,type:'buy',accountId:'SYN-SELLER-TAX',securityId:'SYN-PROPERTY',currency:'CAD',quantity:'10',unitPrice:'30'},
      {id:'SYN-SELLER-LOSS',date:'2026-03-10',seq:1,type:'sell',accountId:'SYN-SELLER-TAX',securityId:'SYN-PROPERTY',currency:'CAD',quantity:'10',unitPrice:'20'},
      {id:'SYN-BUYER-BUY',date:replacementDate,seq:1,type:'buy',accountId:'SYN-BUYER-TAX',securityId:'SYN-PROPERTY',currency:'CAD',quantity:'10',unitPrice:'20'},
      {id:'SYN-BUYER-SELL1',date:'2026-04-15',seq:1,type:'sell',accountId:'SYN-BUYER-TAX',securityId:'SYN-PROPERTY',currency:'CAD',quantity:'5',unitPrice:'25'},
      {id:'SYN-BUYER-SELL2',date:'2026-04-16',seq:1,type:'sell',accountId:'SYN-BUYER-TAX',securityId:'SYN-PROPERTY',currency:'CAD',quantity:'5',unitPrice:'25'}
    ]
  };
  s.events.sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq);
  return s;
};
test('affiliated taxable replacement after a loss flags both later partial and liquidation sales',()=>{
  const r=run(affiliatedReplacementScenario());
  const a=pool(r,'SYN-SELLER','SYN-IDENTICAL'),b=pool(r,'SYN-BUYER','SYN-IDENTICAL');
  assert.deepEqual([a.units,a.acbCad,b.units,b.acbCad],
    ['0.0000','0.00','0.0000','0.00']);
  assert.deepEqual([a.unresolvedLossEventIds,b.unresolvedLossEventIds],
    [['SYN-SELLER-LOSS'],['SYN-SELLER-LOSS']]);
  assert.deepEqual(r.dispositions.map(d=>d.preliminaryGainOrLossCad),
    ['-100.00','25.00','25.00']);
  for(const d of r.dispositions.slice(1)){
    assert.equal(d.ownerId,'SYN-BUYER');
    assert.equal(d.lossReview.status,'REVIEW_REQUIRED');
    assert.equal(d.lossReview.reason,'PRIOR_LOSS_BASIS_UNRESOLVED');
    assert.deepEqual(d.basisReview.unresolvedLossEventIds,['SYN-SELLER-LOSS']);
    assert.equal(d.taxReady,false);
  }
  assert.equal(b.basisReviewStatus,'REVIEW_REQUIRED');
  assert.notEqual(a.ownerId,b.ownerId);
});
test('affiliated taxable acquisition BEFORE the loss also flags later replacement sales',()=>{
  const r=run(affiliatedReplacementScenario({replacementDate:'2026-03-05'}));
  const loss=r.dispositions[0];
  assert.ok(loss.lossReview.nearAcquisitions.some(c=>c.eventId==='SYN-BUYER-BUY'&&c.daysFromSale===-5));
  const b=pool(r,'SYN-BUYER','SYN-IDENTICAL');
  assert.deepEqual(b.unresolvedLossEventIds,['SYN-SELLER-LOSS']);
  assert.equal(r.dispositions[1].lossReview.status,'REVIEW_REQUIRED');
  assert.equal(r.dispositions[2].lossReview.status,'REVIEW_REQUIRED');
});
test('identical property in an UNRELATED owner does not inherit another owner loss',()=>{
  const r=run(affiliatedReplacementScenario({affiliated:false}));
  const b=pool(r,'SYN-BUYER','SYN-IDENTICAL');
  assert.deepEqual(b.unresolvedLossEventIds,[]);
  assert.equal(b.basisReviewStatus,'NO_KNOWN_LOSS_FLAGS');
  assert.equal(r.dispositions[1].lossReview,null);
  assert.equal(r.dispositions[1].basisReview,null);
  assert.equal(r.dispositions[2].lossReview,null);
  assert.equal(r.dispositions[2].basisReview,null);
  assert.equal(r.dispositions[0].lossReview.nearAcquisitions.some(c=>c.accountId==='SYN-BUYER-TAX'),false);
});
test('registered replacement acquisition is a loss candidate but does not taint a different taxable pool',()=>{
  const s=affiliatedReplacementScenario();
  s.accounts.push({id:'SYN-BUYER-TFSA',ownerId:'SYN-BUYER',affiliationGroupId:'SYN-FAMILY-ONE',type:'tfsa'});
  // Buyer taxable purchase outside the +/-30 day window; buyer TFSA within.
  s.events.find(e=>e.id==='SYN-BUYER-BUY').date='2026-01-15';
  s.events.push({id:'SYN-TFSA-REBUY',date:'2026-03-15',seq:1,type:'buy',
    accountId:'SYN-BUYER-TFSA',securityId:'SYN-PROPERTY',currency:'CAD',quantity:'4',unitPrice:'20'});
  s.events.sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq);
  const r=run(s),b=pool(r,'SYN-BUYER','SYN-IDENTICAL');
  const sellerSale=r.dispositions.find(d=>d.eventId==='SYN-SELLER-LOSS');
  assert.ok(sellerSale.lossReview.nearAcquisitions.some(c=>
    c.eventId==='SYN-TFSA-REBUY' && c.accountType==='tfsa'));
  assert.deepEqual(b.unresolvedLossEventIds,[]);
  assert.equal(b.basisReviewStatus,'NO_KNOWN_LOSS_FLAGS');
  for(const d of r.dispositions.filter(d=>d.ownerId==='SYN-BUYER')){
    assert.equal(d.lossReview,null);
    assert.equal(d.basisReview,null);
  }
  assert.equal(r.accountUnits.find(x=>x.accountId==='SYN-BUYER-TFSA').units,'4.0000');
});
test('multiple affiliated taxable replacement accounts share the buyer tax pool without duplicating warning IDs',()=>{
  const s=affiliatedReplacementScenario();
  s.accounts.push({id:'SYN-BUYER-TAX-TWO',ownerId:'SYN-BUYER',affiliationGroupId:'SYN-FAMILY-ONE',type:'taxable'});
  s.events.push({id:'SYN-BUYER-BUY-TWO',date:'2026-03-16',seq:1,type:'buy',
    accountId:'SYN-BUYER-TAX-TWO',securityId:'SYN-PROPERTY',currency:'CAD',quantity:'2',unitPrice:'20'});
  s.events.push({id:'SYN-BUYER-SELL-TWO',date:'2026-04-17',seq:1,type:'sell',
    accountId:'SYN-BUYER-TAX-TWO',securityId:'SYN-PROPERTY',currency:'CAD',quantity:'2',unitPrice:'25'});
  s.events.sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq);
  const r=run(s),b=pool(r,'SYN-BUYER','SYN-IDENTICAL');
  assert.deepEqual(b.unresolvedLossEventIds,['SYN-SELLER-LOSS']);
  assert.equal(r.dispositions.length,4);
  assert.deepEqual(r.dispositions.filter(d=>d.ownerId==='SYN-BUYER')
    .map(d=>d.basisReview.unresolvedLossEventIds),
    [['SYN-SELLER-LOSS'],['SYN-SELLER-LOSS'],['SYN-SELLER-LOSS']]);
});


// Propagation is a conservative graph of unresolved basis dependencies.
// An apparent gain can become an additional superficial-loss candidate if
// an upstream loss eventually increases the intermediate owner's basis.
// No legal loss conclusion or numerical cross-owner ACB changes are modeled.
const transitiveAffiliatedFixture=({cBuyDate='2026-05-05',cAffiliated=true,includeD=false}={})=>{
  const accounts=[
    {id:'SYN-A-TAX',ownerId:'SYN-OWNER-A',affiliationGroupId:'SYN-RELATED',type:'taxable'},
    {id:'SYN-B-TAX',ownerId:'SYN-OWNER-B',affiliationGroupId:'SYN-RELATED',type:'taxable'},
    {id:'SYN-C-TAX',ownerId:'SYN-OWNER-C',affiliationGroupId:cAffiliated?'SYN-RELATED':'SYN-UNRELATED',type:'taxable'}
  ];
  const events=[
    {id:'SYN-A-BUY',date:'2026-01-01',seq:1,type:'buy',accountId:'SYN-A-TAX',securityId:'SYN-STOCK-X',currency:'CAD',quantity:'10',unitPrice:'30'},
    {id:'SYN-A-LOSS',date:'2026-03-10',seq:1,type:'sell',accountId:'SYN-A-TAX',securityId:'SYN-STOCK-X',currency:'CAD',quantity:'10',unitPrice:'20'},
    {id:'SYN-B-BUY',date:'2026-03-15',seq:1,type:'buy',accountId:'SYN-B-TAX',securityId:'SYN-STOCK-X',currency:'CAD',quantity:'10',unitPrice:'20'},
    {id:'SYN-B-GAIN',date:'2026-05-01',seq:1,type:'sell',accountId:'SYN-B-TAX',securityId:'SYN-STOCK-X',currency:'CAD',quantity:'10',unitPrice:'25'},
    {id:'SYN-C-BUY',date:cBuyDate,seq:1,type:'buy',accountId:'SYN-C-TAX',securityId:'SYN-STOCK-X',currency:'CAD',quantity:'10',unitPrice:'25'},
    {id:'SYN-C-GAIN',date:'2026-07-01',seq:1,type:'sell',accountId:'SYN-C-TAX',securityId:'SYN-STOCK-X',currency:'CAD',quantity:'10',unitPrice:'27'}
  ];
  if(includeD){
    accounts.push({id:'SYN-D-TAX',ownerId:'SYN-OWNER-D',affiliationGroupId:'SYN-RELATED',type:'taxable'});
    events.push(
      {id:'SYN-D-BUY',date:'2026-07-05',seq:1,type:'buy',accountId:'SYN-D-TAX',securityId:'SYN-STOCK-X',currency:'CAD',quantity:'10',unitPrice:'27'},
      {id:'SYN-D-GAIN',date:'2026-08-15',seq:1,type:'sell',accountId:'SYN-D-TAX',securityId:'SYN-STOCK-X',currency:'CAD',quantity:'10',unitPrice:'29'}
    );
  }
  events.sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq);
  return {synthetic:true,accounts,securities:[
    {id:'SYN-STOCK-X',identicalPropertyId:'SYN-IDENT-X',currency:'CAD',kind:'equity'}
  ],events};
};
test('transitive affiliated owners A->B->C inherit root loss warning through B apparent gain',()=>{
  const r=run(transitiveAffiliatedFixture());
  assert.deepEqual(r.dispositions.map(d=>d.preliminaryGainOrLossCad),
    ['-100.00','50.00','20.00']);
  const [a,b,c]=['SYN-OWNER-A','SYN-OWNER-B','SYN-OWNER-C']
    .map(owner=>pool(r,owner,'SYN-IDENT-X'));
  assert.deepEqual([a.acbCad,b.acbCad,c.acbCad],['0.00','0.00','0.00']);
  assert.deepEqual([a.units,b.units,c.units],['0.0000','0.0000','0.0000']);
  assert.deepEqual([a.unresolvedLossEventIds,b.unresolvedLossEventIds,c.unresolvedLossEventIds],
    [['SYN-A-LOSS'],['SYN-A-LOSS'],['SYN-A-LOSS']]);
  assert.equal(r.dispositions[1].lossReview.reason,'PRIOR_LOSS_BASIS_UNRESOLVED');
  assert.deepEqual(r.dispositions[2].basisReview.unresolvedLossEventIds,['SYN-A-LOSS']);
  assert.equal(r.dispositions[2].lossReview.status,'REVIEW_REQUIRED');
  assert.equal(r.dispositions[2].taxReady,false);
  assert.notEqual(r.dispositions[2].preliminaryGainOrLossCad,r.dispositions[0].preliminaryGainOrLossCad);
});
test('transitive chain is not propagated to an unrelated owner',()=>{
  const r=run(transitiveAffiliatedFixture({cAffiliated:false}));
  const c=pool(r,'SYN-OWNER-C','SYN-IDENT-X');
  assert.equal(c.acbCad,'0.00');
  assert.equal(c.basisReviewStatus,'NO_KNOWN_LOSS_FLAGS');
  assert.deepEqual(c.unresolvedLossEventIds,[]);
  assert.equal(r.dispositions[2].lossReview,null);
  assert.equal(r.dispositions[2].basisReview,null);
  assert.equal(r.dispositions[2].preliminaryGainOrLossCad,'20.00');
});
test('transitive review is bounded by each intermediate sale 30-day candidate window',()=>{
  const r=run(transitiveAffiliatedFixture({cBuyDate:'2026-06-01'}));
  const b=r.dispositions[1],c=r.dispositions[2];
  assert.equal(b.lossReview.status,'REVIEW_REQUIRED');
  assert.equal(r.pools.find(p=>p.ownerId==='SYN-OWNER-C').basisReviewStatus,'NO_KNOWN_LOSS_FLAGS');
  assert.equal(c.lossReview,null);
  assert.equal(c.basisReview,null);
});
test('transitive uncertainty continues through a fourth affiliated owner and preserves numerical segregation',()=>{
  const r=run(transitiveAffiliatedFixture({includeD:true}));
  const d=pool(r,'SYN-OWNER-D','SYN-IDENT-X');
  assert.equal(d.acbCad,'0.00');
  assert.deepEqual(d.unresolvedLossEventIds,['SYN-A-LOSS']);
  assert.equal(r.dispositions[3].preliminaryGainOrLossCad,'20.00');
  assert.deepEqual(r.dispositions[3].basisReview.unresolvedLossEventIds,['SYN-A-LOSS']);
  assert.equal(r.dispositions[3].lossReview.status,'REVIEW_REQUIRED');
  assert.equal(r.dispositions[3].taxReady,false);
});
