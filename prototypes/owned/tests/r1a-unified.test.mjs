import test from 'node:test';
import assert from 'node:assert/strict';
import {Q} from '../accounting/rational.mjs';
import {
  getUnifiedSyntheticJournal,R1A_JOURNAL_ID,R1A_TAX_SECURITY
} from '../backend/r1a-journal.mjs';
import {buildUnifiedSyntheticViews} from '../backend/r1a-unified.mjs';
import {calculateSyntheticHoldings} from '../backend/holdings.mjs';
import {createAppServer} from '../backend/server.mjs';

test('R1a projections share one dated fictional journal and reconcile taxable custody',()=>{
  const result=buildUnifiedSyntheticViews();
  assert.equal(result.synthetic,true);
  assert.equal(result.journalId,R1A_JOURNAL_ID);
  assert.equal(result.overview.journalId,result.taxLab.journalId);
  assert.equal(result.holdings.accountCount,4);
  assert.equal(result.overview.cadEquivalent,result.holdings.cadEquivalent);
  assert.deepEqual(result.overview.currencyTotals,result.holdings.currencyTotals);
  assert.deepEqual(result.overview.takeaway,result.holdings.takeaway);
  assert.equal(result.taxLab.before.units,'20');
  assert.equal(result.taxLab.before.cost,'CA$2200.00');
  assert.equal(result.taxLab.after.units,'15');
  assert.equal(result.taxLab.after.cost,'CA$1650.00');
  assert.equal(result.taxLab.sale.preliminaryGain,'CA$198.00');
  assert.equal(result.reconciliation.matched,true);
  assert.equal(result.reconciliation.taxableUnits,result.taxLab.after.units);
  assert.equal(result.taxLab.sale.accountLetter,'A');
});

test('same event mutation changes both native custody basis and pooled tax cost',()=>{
  const journal=getUnifiedSyntheticJournal();
  const original=buildUnifiedSyntheticViews(journal);
  const buy=journal.events.find(e=>e.id==='SYN-R1A-BUY-B');
  assert.ok(buy);
  buy.unitPrice='130';
  const modified=buildUnifiedSyntheticViews(journal);
  const oldPos=original.holdings.positions.find(p=>p.accountId==='SYN-CAD-TAX-B'&&p.securityId===R1A_TAX_SECURITY);
  const newPos=modified.holdings.positions.find(p=>p.accountId==='SYN-CAD-TAX-B'&&p.securityId===R1A_TAX_SECURITY);
  assert.equal(oldPos.bookValueNative,'1200.00');
  assert.equal(newPos.bookValueNative,'1300.00');
  assert.equal(modified.taxLab.before.cost,'CA$2300.00');
  assert.equal(modified.taxLab.after.cost,'CA$1725.00');
  assert.equal(modified.taxLab.sale.preliminaryGain,'CA$173.00');
  assert.equal(modified.reconciliation.matched,true);
});

test('account filter changes Overview and Holdings but never redefines owner pooled ACB',()=>{
  const all=buildUnifiedSyntheticViews();
  const one=buildUnifiedSyntheticViews(undefined,{accountIds:['SYN-CAD-TAX']});
  assert.deepEqual(one.overview.selectedAccountIds,['SYN-CAD-TAX']);
  assert.deepEqual(one.holdings.selectedAccountIds,['SYN-CAD-TAX']);
  assert.equal(one.overview.cadEquivalent,one.holdings.cadEquivalent);
  assert.equal(one.holdings.accountCount,1);
  assert.notEqual(one.overview.cadEquivalent,all.overview.cadEquivalent);
  assert.deepEqual(one.taxLab.before,all.taxLab.before);
  assert.deepEqual(one.taxLab.after,all.taxLab.after);
  assert.match(one.taxLab.scope,/independent of Holdings filters/);
  const position=one.holdings.positions.find(p=>p.securityId===R1A_TAX_SECURITY);
  assert.equal(Q.of(position.quantity).cmp(Q.of('5')),0);
});

test('USD valuation requires dated FX while taxable CAD ACB remains calculable',()=>{
  const journal=getUnifiedSyntheticJournal();
  delete journal.valuationFx;
  const all=buildUnifiedSyntheticViews(journal);
  assert.equal(all.overview.valuationState,'missing-fx');
  assert.equal(all.overview.cadEquivalent,null);
  assert.equal(all.holdings.exposure,null);
  assert.equal(all.taxLab.sale.preliminaryGain,'CA$198.00');
  const cadOnly=buildUnifiedSyntheticViews(journal,{accountIds:['SYN-CAD-TAX','SYN-CAD-TAX-B']});
  assert.equal(cadOnly.overview.valuationState,'valued');
  assert.notEqual(cadOnly.overview.cadEquivalent,null);
});

test('journal copies are fresh; invalid journal or unaccounted taxable sale fails closed',()=>{
  const a=getUnifiedSyntheticJournal(),b=getUnifiedSyntheticJournal();
  a.events[0].amount='1';
  assert.notEqual(a.events[0].amount,b.events[0].amount);
  assert.throws(()=>buildUnifiedSyntheticViews({...b,synthetic:false}),/fictional journal/);
  assert.throws(()=>buildUnifiedSyntheticViews(b,{accountIds:['SYN-MISSING']}),/account selection/);
  const broken=getUnifiedSyntheticJournal();
  broken.events.find(e=>e.id==='SYN-R1A-SELL-A').quantity='100';
  assert.throws(()=>buildUnifiedSyntheticViews(broken),/sell|units|Insufficient/i);
});

test('R1a HTTP surface is read-only, fixture-only, and selection-consistent',async()=>{
  const server=createAppServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  const base='http://127.0.0.1:'+address.port;
  try{
    const ok=await fetch(base+'/api/r1a/state');
    assert.equal(ok.status,200);
    const all=await ok.json();
    assert.equal(all.synthetic,true);
    assert.equal(all.holdings.accountCount,4);
    const one=await fetch(base+'/api/r1a/state?accounts=SYN-CAD-TAX');
    assert.equal(one.status,200);
    const selected=await one.json();
    assert.equal(selected.holdings.accountCount,1);
    assert.equal(selected.overview.cadEquivalent,selected.holdings.cadEquivalent);
    assert.deepEqual(selected.taxLab.before,all.taxLab.before);
    for(const path of [
      '/api/r1a/state?accounts=SYN-MISSING',
      '/api/r1a/state?accounts=SYN-CAD-TAX&unexpected=123',
      '/api/r1a/state?accounts=SYN-CAD-TAX,SYN-CAD-TAX'
    ]){
      const response=await fetch(base+path);
      assert.equal(response.status,400);
    }
    const post=await fetch(base+'/api/r1a/state',{method:'POST',body:'{}'});
    assert.equal(post.status,405);
  }finally{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});

function journalWithSamePropertyAlias(){
  const journal=getUnifiedSyntheticJournal();
  const original=journal.securities.find(s=>s.id===R1A_TAX_SECURITY);
  assert.ok(original);
  journal.securities.push({
    ...structuredClone(original),id:'SYN-EQUITY-ALIAS',
    symbol:'SYNALIAS01',name:'Fictional tax-identical custody alias'
  });
  journal.quotes.push({
    securityId:'SYN-EQUITY-ALIAS',currency:'CAD',
    unitPrice:'105',asOf:journal.asOf
  });
  return journal;
}
function addAliasPurchase(journal,accountId,id,date='2026-02-07'){
  journal.events.push({
    id,date,seq:1,accountId,type:'buy',currency:'CAD',
    securityId:'SYN-EQUITY-ALIAS',quantity:'1',unitPrice:'200',fee:'0'
  });
  journal.events.sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq);
}

test('same-owner taxable identical-property alias fails closed before claiming reconciled ACB',()=>{
  const journal=journalWithSamePropertyAlias();
  addAliasPurchase(journal,'SYN-CAD-TAX-B','SYN-R1A-ALIAS-TAX');
  const custody=calculateSyntheticHoldings(journal);
  assert.ok(custody.positions.some(p=>
    p.securityId==='SYN-EQUITY-ALIAS'&&p.accountId==='SYN-CAD-TAX-B'));
  assert.throws(
    ()=>buildUnifiedSyntheticViews(journal),
    /Unsupported taxable identical-property alias activity/
  );
  // A filtered Holdings view must not suppress missing owner-wide taxable activity.
  assert.throws(
    ()=>buildUnifiedSyntheticViews(journal,{accountIds:['SYN-CAD-TFSA']}),
    /Unsupported taxable identical-property alias activity/
  );
});

test('TFSA and unrelated-owner alias purchases remain outside the scoped taxable ACB',()=>{
  const tfsaJournal=journalWithSamePropertyAlias();
  addAliasPurchase(tfsaJournal,'SYN-CAD-TFSA','SYN-R1A-ALIAS-TFSA');
  const tfsa=buildUnifiedSyntheticViews(tfsaJournal);
  assert.equal(tfsa.reconciliation.matched,true);
  assert.equal(tfsa.taxLab.after.units,'15');
  assert.equal(tfsa.taxLab.after.cost,'CA$1650.00');
  assert.ok(tfsa.holdings.positions.some(p=>p.securityId==='SYN-EQUITY-ALIAS'));

  const unrelated=journalWithSamePropertyAlias();
  unrelated.accounts.push({
    id:'SYN-OTHER-TAX',ownerId:'SYN-OTHER-OWNER',
    affiliationGroupId:'SYN-OTHER-HOUSEHOLD',
    label:'Fictional other owner',type:'taxable',currency:'CAD'
  });
  unrelated.events.push({
    id:'SYN-R1A-OTHER-DEPOSIT',date:'2026-01-06',seq:1,
    accountId:'SYN-OTHER-TAX',type:'deposit',currency:'CAD',amount:'1000'
  });
  addAliasPurchase(unrelated,'SYN-OTHER-TAX','SYN-R1A-ALIAS-OTHER');
  const result=buildUnifiedSyntheticViews(unrelated);
  assert.equal(result.reconciliation.matched,true);
  assert.equal(result.taxLab.before.cost,'CA$2200.00');
  assert.equal(result.taxLab.after.cost,'CA$1650.00');
  assert.ok(result.holdings.positions.some(p=>p.accountId==='SYN-OTHER-TAX'));
});

test('unknown or malformed taxable property identity rejects unfiltered and filtered reconciliation',()=>{
  const cases=[
    ['missing',undefined],['null',null],['empty',''],
    ['non-synthetic','UNKNOWN-PROPERTY'],['incomplete','SYN-']
  ];
  for(const [name,identity] of cases){
    const journal=journalWithSamePropertyAlias();
    const alias=journal.securities.find(s=>s.id==='SYN-EQUITY-ALIAS');
    if(identity===undefined)delete alias.identicalPropertyId;
    else alias.identicalPropertyId=identity;
    addAliasPurchase(journal,'SYN-CAD-TAX-B','SYN-R1A-ALIAS-TAX');
    // Native holdings still recognize this active instrument, which must
    // NEVER be omitted from ACB validation because its metadata is absent.
    assert.ok(calculateSyntheticHoldings(journal).positions.some(p=>
      p.securityId==='SYN-EQUITY-ALIAS'&&p.accountId==='SYN-CAD-TAX-B'),name);
    for(const options of [{},{accountIds:['SYN-CAD-TFSA']}]){
      assert.throws(
        ()=>buildUnifiedSyntheticViews(journal,options),
        /Missing or invalid identical-property identity for owner taxable trade/,
        name+' must fail closed, even when the affected account is filtered out'
      );
    }
  }
});

test('closed taxable alias history still needs identity; TFSA and other-owner activity remain distinct',()=>{
  const closed=journalWithSamePropertyAlias();
  delete closed.securities.find(s=>s.id==='SYN-EQUITY-ALIAS').identicalPropertyId;
  addAliasPurchase(closed,'SYN-CAD-TAX-B','SYN-R1A-ALIAS-TAX');
  closed.events.push({
    id:'SYN-R1A-ALIAS-SELL',date:'2026-02-08',seq:1,
    accountId:'SYN-CAD-TAX-B',type:'sell',securityId:'SYN-EQUITY-ALIAS',
    currency:'CAD',quantity:'1',unitPrice:'220',fee:'0'
  });
  closed.events.sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq);
  assert.equal(calculateSyntheticHoldings(closed).positions.some(p=>
    p.securityId==='SYN-EQUITY-ALIAS'),false);
  assert.throws(()=>buildUnifiedSyntheticViews(closed),
    /Missing or invalid identical-property identity for owner taxable trade/);

  const tfsa=journalWithSamePropertyAlias();
  delete tfsa.securities.find(s=>s.id==='SYN-EQUITY-ALIAS').identicalPropertyId;
  addAliasPurchase(tfsa,'SYN-CAD-TFSA','SYN-R1A-ALIAS-TFSA');
  const tfsaView=buildUnifiedSyntheticViews(tfsa);
  assert.equal(tfsaView.reconciliation.matched,true);
  assert.equal(tfsaView.taxLab.after.cost,'CA$1650.00');

  const unrelated=journalWithSamePropertyAlias();
  unrelated.securities.find(s=>s.id==='SYN-EQUITY-ALIAS').identicalPropertyId=null;
  unrelated.accounts.push({
    id:'SYN-OTHER-TAX',ownerId:'SYN-OTHER-OWNER',
    affiliationGroupId:'SYN-OTHER-HOUSEHOLD',
    label:'Fictional other owner',type:'taxable',currency:'CAD'
  });
  unrelated.events.push({
    id:'SYN-R1A-OTHER-DEPOSIT',date:'2026-01-06',seq:1,
    accountId:'SYN-OTHER-TAX',type:'deposit',currency:'CAD',amount:'1000'
  });
  addAliasPurchase(unrelated,'SYN-OTHER-TAX','SYN-R1A-ALIAS-OTHER');
  const otherView=buildUnifiedSyntheticViews(unrelated);
  assert.equal(otherView.reconciliation.matched,true);
  assert.equal(otherView.taxLab.before.cost,'CA$2200.00');
});
