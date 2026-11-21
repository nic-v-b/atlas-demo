import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUnifiedSyntheticViews} from '../backend/r1a-unified.mjs';
import {getUnifiedSyntheticJournal} from '../backend/r1a-journal.mjs';
import {validateJournalResponse,SELECTION_KEY} from '../web/journal-response.mjs';
import {frontendHarness,settle} from './frontend-harness.mjs';
import {createAppServer} from '../backend/server.mjs';
import {Q} from '../accounting/rational.mjs';

const base=buildUnifiedSyntheticViews(),chosen=['SYN-CAD-TFSA'];
const filtered=()=>buildUnifiedSyntheticViews(undefined,{accountIds:chosen});
const pages=[['app.js','index.html','overview-total','overview-error'],
  ['holdings.js','holdings.html','cad-equivalent','h-error']];
async function deliver(h,payload){h.requests.at(-1).resolve(payload);await settle();}
function setPath(object,path,value){
  const parts=path.split('.'),key=parts.pop();
  const parent=parts.reduce((o,k)=>o[k],object);
  if(value===undefined)delete parent[key];else parent[key]=value;
}
for(const [script,page,total,error] of pages){
  for(const loss of ['getItem throws','key disappears','getter throws','storage undefined','writes throw']){
    test(script+' retains verified single account through '+loss,async()=>{
      const storage=new Map([[SELECTION_KEY,JSON.stringify(chosen)]]);
      let lost=false;
      const h=await frontendHarness(script,page,{storage,storageAccess(s){
        if(!lost)return s;
        if(loss==='getter throws')throw Error('Synthetic denied getter');
        if(loss==='storage undefined')return undefined;
        if(loss==='getItem throws')return {...s,getItem(){throw Error('Synthetic read denial');}};
        if(loss==='writes throw')return {...s,setItem(){throw Error('Synthetic write denial');}};
        return s;
      }});
      await deliver(h,filtered());const before=h.node(total).textContent;
      lost=true;if(loss==='key disappears')storage.delete(SELECTION_KEY);
      for(let i=0;i<2;i++){
        h.node('retry-load').click();
        assert.equal(h.requests.at(-1).url,'/api/r1a/state?accounts='+encodeURIComponent(chosen.join(',')));
        // The exact review's all-account replacement must be rejected too.
        await deliver(h,i===0?base:filtered());
        assert.equal(h.node(total).textContent,before);
        assert.equal(h.node(error).hidden,i!==0);
      }
    });
  }
  for(const failure of ['getter','read','undefined'])test(script+' initializes safely with unavailable storage: '+failure,async()=>{
    const h=await frontendHarness(script,page,{storageAccess(s){
      if(failure==='getter')throw Error('Synthetic denied getter');
      if(failure==='undefined')return undefined;
      return {...s,getItem(){throw Error('Synthetic denied read');}};
    }});
    await settle();assert.equal(h.requests.length,0);
    assert.equal(h.node(total).textContent,'Unavailable');assert.equal(h.node(error).hidden,false);
    h.node('retry-load').click();await settle();assert.equal(h.requests.length,0);
    if(script==='holdings.js'){
      h.node('select-all').click();assert.equal(h.requests.at(-1).url,'/api/r1a/state');
      await deliver(h,base);assert.equal(h.node(error).hidden,true);
      h.node('retry-load').click();
      assert.match(h.requests.at(-1).url,/\?accounts=SYN-/);
      await deliver(h,base);assert.equal(h.node(error).hidden,true);
    }
  });
}
test('Overview keeps a pending saved selection if the key disappears before initial verification',async()=>{
  const storage=new Map([[SELECTION_KEY,JSON.stringify(chosen)]]);
  const h=await frontendHarness('app.js','index.html',{storage});storage.delete(SELECTION_KEY);
  h.node('retry-load').click();assert.equal(h.requests[1].url,h.requests[0].url);
  await deliver(h,filtered());h.requests[0].resolve(base);await settle();
  assert.equal(h.node('overview-selection').textContent,'1 of 4 fictional accounts selected');
});
test('Holdings explicitly expands to all after storage loss and commits only a verified selection',async()=>{
  const storage=new Map([[SELECTION_KEY,JSON.stringify(chosen)]]);
  const h=await frontendHarness('holdings.js','holdings.html',{storage});await deliver(h,filtered());
  storage.delete(SELECTION_KEY);h.node('select-all').click();
  assert.equal(new URL(h.requests.at(-1).url,'http://localhost').searchParams.get('accounts').split(',').length,4);
  assert.equal(storage.has(SELECTION_KEY),false);await deliver(h,base);
  assert.equal(JSON.parse(storage.get(SELECTION_KEY)).length,4);
});

// Independent cent-display goldens: below, at and above each half-cent tie.
const roundedGainCases=[
  ['0','CA$0.00'],['0.004','CA$0.00'],['-0.004','CA$0.00'],
  ['0.004999','CA$0.00'],['-0.004999','CA$0.00'],
  ['0.005','CA$0.01'],['-0.005','-CA$0.01'],
  ['0.005001','CA$0.01'],['-0.005001','-CA$0.01']
];
for(const seller of ['SYN-CAD-TAX','SYN-CAD-TAX-B'])for(const fee of ['0','0.005'])
  for(const equalCosts of [false,true])for(const [gain,display] of roundedGainCases)
    test('Tax Lab rounded gain '+gain+' seller '+seller+' fee '+fee+' equal costs '+equalCosts,async()=>{
      const journal=getUnifiedSyntheticJournal();
      if(equalCosts)for(const buy of journal.events.filter(e=>e.type==='buy'&&e.securityId==='SYN-EQUITY-1')){
        buy.unitPrice='110';buy.fee='0';
      }
      const sale=journal.events.find(e=>e.id==='SYN-R1A-SELL-A');
      sale.accountId=seller;sale.quantity='5';sale.fee=fee;
      sale.unitPrice=Q.of('110').add(Q.of(gain).add(Q.of(fee)).div(Q.of('5'))).fixed(12);
      // Includes the review's exact 109.9992 / zero-fee counterexample.
      const exact=Q.of(sale.quantity).mul(Q.of(sale.unitPrice)).sub(Q.of(fee)).sub(Q.of('550'));
      assert.equal(exact.cmp(Q.of(gain)),0);
      const payload=buildUnifiedSyntheticViews(journal);validateJournalResponse(payload);
      assert.equal(payload.taxLab.sale.preliminaryGain,display);
      if(equalCosts)assert.equal(payload.taxLab.sale.accountOnlyGain,display);
      assert.equal(payload.taxLab.calculationInputs.sale.unitPrice,sale.unitPrice);
      assert.equal(payload.taxLab.calculationInputs.sale.fee,fee);
      assert.equal(payload.taxLab.sale.lossReview!==null,exact.cmp(Q.zero())<0);

      const h=await frontendHarness('tax-lab.js','acb-lab.html');await deliver(h,payload);
      const assertRendered=()=>{
        assert.equal(h.node('acb-sale-gain').textContent,display);
        assert.equal(h.node('acb-correct').textContent,display);
        assert.equal(h.node('acb-naive').textContent,payload.taxLab.sale.accountOnlyGain);
        assert.equal(h.node('acb-timeline').childElementCount,3);
      };
      assert.equal(h.node('acb-status').textContent,'CALCULATED');assertRendered();
      h.node('retry-load').click();h.requests.at(-1).httpFailure();await settle();
      assert.equal(h.node('acb-status').textContent,'STALE · LAST VERIFIED');assertRendered();
      h.node('retry-load').click();await deliver(h,payload);
      assert.equal(h.node('acb-status').textContent,'CALCULATED');assertRendered();

      for(const [path,value] of [
        ['sale.preliminaryGain','-CA$0.00'],['sale.accountOnlyGain','-CA$0.00'],
        ['sale.preliminaryGain',display==='-CA$0.01'?'CA$0.01':'-CA$0.01'],
        ['sale.proceeds','CA$999999.00']
      ]){
        const bad=structuredClone(payload);setPath(bad.taxLab,path,value);
        assert.throws(()=>validateJournalResponse(bad),/response rejected/);
        h.node('retry-load').click();await deliver(h,bad);
        assert.equal(h.node('acb-status').textContent,'STALE · LAST VERIFIED');assertRendered();
        h.node('retry-load').click();await deliver(h,payload);
        assert.equal(h.node('acb-status').textContent,'CALCULATED');assertRendered();
      }
      const invalid=structuredClone(payload);invalid.taxLab.sale.preliminaryGain='-CA$0.00';
      const initial=await frontendHarness('tax-lab.js','acb-lab.html');await deliver(initial,invalid);
      assert.equal(initial.node('acb-status').textContent,'DATA UNAVAILABLE');
      assert.equal(initial.node('acb-sale-gain').textContent,'Unavailable');
      initial.node('retry-load').click();await deliver(initial,payload);
      assert.equal(initial.node('acb-status').textContent,'CALCULATED');
      assert.equal(initial.node('acb-sale-gain').textContent,display);
    });

const monetaryContradictions=[
  ['sale.preliminaryGain','CA$999999.00'],['sale.preliminaryGain','CA$198.01'],
  ['sale.proceeds','CA$750.00'],['sale.allocatedAcb','CA$551.00'],['sale.unitPrice','CA$151.00'],
  ['sale.accountOnlyGain','CA$249.00'],['sale.accountLetter','B'],
  ['before.cost','CA$2201.00'],['before.average','CA$110.01'],['before.units','21'],
  ['after.cost','CA$1651.00'],['after.average','CA$110.01'],['after.units','14'],
  ['accounts.0.cost','CA$1001.00'],['accounts.1.cost','CA$1201.00'],
  ['accounts.0.detail','10 shares × CA$101.00'],['accounts.0.pct',45.6],
  ['calculationInputs.purchases.0.quantity','11'],['calculationInputs.purchases.1.unitPrice','121'],
  ['calculationInputs.purchases.0.fee','1'],['calculationInputs.sale.fee','0'],
  ['calculationInputs.sale.accountId','SYN-CAD-TFSA'],['calculationInputs.sale.quantity','11'],
  ['calculationInputs',undefined]
];
for(const [path,value] of monetaryContradictions)test('reject individually well-formed contradictory Tax Lab '+path+' = '+value,()=>{
  const payload=structuredClone(base);setPath(payload.taxLab,path,value);
  assert.throws(()=>validateJournalResponse(payload),/response rejected/);
});
test('Tax Lab coherence uses exact fractions across fees, fractional units, half cents and both sellers',()=>{
  for(const seller of ['SYN-CAD-TAX','SYN-CAD-TAX-B'])for(const price of ['20.00496','20.005','20.00504','50.123456789012']){
    const journal=getUnifiedSyntheticJournal();
    const a=journal.events.find(e=>e.type==='buy'&&e.accountId==='SYN-CAD-TAX'&&e.securityId==='SYN-EQUITY-1');
    a.quantity='10.25';a.unitPrice=price;a.fee='0.003';
    const b=journal.events.find(e=>e.id==='SYN-R1A-BUY-B');b.unitPrice='50';b.fee='0.007';
    const sale=journal.events.find(e=>e.id==='SYN-R1A-SELL-A');
    sale.accountId=seller;sale.quantity='5.123456789012';sale.unitPrice='30.000000000001';sale.fee='0.005';
    const payload=buildUnifiedSyntheticViews(journal);validateJournalResponse(payload);
    const bad=structuredClone(payload);bad.taxLab.after.average='CA$999.99';
    assert.throws(()=>validateJournalResponse(bad),/response rejected/);
  }
});
test('independent half-cent gain golden accepts once-rounded exact result when rounded operands disagree',()=>{
  const journal=getUnifiedSyntheticJournal();
  const sale=journal.events.find(e=>e.id==='SYN-R1A-SELL-A');sale.unitPrice='150.001';sale.fee='2';
  const buy=journal.events.find(e=>e.id==='SYN-R1A-BUY-B');buy.fee='0.016';
  const payload=buildUnifiedSyntheticViews(journal);
  assert.equal(payload.taxLab.sale.proceeds,'CA$748.01');
  assert.equal(payload.taxLab.sale.allocatedAcb,'CA$550.00');
  assert.equal(payload.taxLab.sale.preliminaryGain,'CA$198.00');
  // Exact proceeds 748.005 minus exact ACB 550.004 = 198.001;
  // rounded operands instead subtract to 198.01.
  validateJournalResponse(payload);
});

// Mutate each narrative field independently, preserving all structured amounts.
// Exercise the actual renderer as well as the response boundary: no invalid
// narrative may acquire CALCULATED or replace the last verified snapshot.
const narrativeContradictions=[
  ['timeline.2.detail','5 shares sold; 999999.00 CAD pooled cost allocated.'],
  ...[0,1].flatMap(i=>[
    ['timeline.'+i+'.detail',base.taxLab.timeline[i].detail.replace(/added CA\$[\d.]+/,'added CA$999999.00')],
    ['timeline.'+i+'.detail',base.taxLab.timeline[i].detail.replace('10 shares','11 shares')],
    ['timeline.'+i+'.detail',base.taxLab.timeline[i].detail.replace(/× CA\$[\d.]+/,'× CA$999999.00')],
    ['timeline.'+i+'.detail',base.taxLab.timeline[i].detail+' CA$999999.00 purchase fee.'],
    ['timeline.'+i+'.title','Buy in Account '+(i===0?'B':'A')],
    ['accounts.'+i+'.label','Taxable account '+(i===0?'B':'A')],
    ['accounts.'+i+'.label','Taxable account '+(i===0?'A':'B')+' holds CA$999999.00'],
    ['accounts.'+i+'.detail',base.taxLab.accounts[i].detail+' plus CA$999999.00 fee.']
  ]),
  ...['pooledFormula','accountOnlyFormula'].flatMap(key=>[
    ['sale.'+key,base.taxLab.sale[key].replace('CA$2.00','CA$999999.00')],
    ['sale.'+key,base.taxLab.sale[key].replace('CA$2.00','CA$0.00')],
    ['sale.'+key,base.taxLab.sale[key]+' Gross proceeds are CA$999999.00.']
  ]),
  ['timeline.2.detail','6 shares sold; 550.00 CAD pooled cost allocated.'],
  ['timeline.2.detail',base.taxLab.timeline[2].detail+' CA$999999.00 selling fee.'],
  ['timeline.2.title','Sell from Account B'],
  ['timeline.0.date','2025-01-01'],
  ['timeline.1.date','2025-01-02'],
  ['timeline.2.date','2025-01-03'],
  ['timeline',[base.taxLab.timeline[1],base.taxLab.timeline[0],base.taxLab.timeline[2]]]
];
for(const [index,[path,value]] of narrativeContradictions.entries())test('Tax Lab rejects unsupported narrative '+index+' '+path,async()=>{
  const bad=structuredClone(base);setPath(bad.taxLab,path,value);
  assert.throws(()=>validateJournalResponse(bad),/response rejected/);
  const h=await frontendHarness('tax-lab.js','acb-lab.html');await deliver(h,bad);
  assert.equal(h.node('acb-status').textContent,'DATA UNAVAILABLE');
  assert.equal(h.node('acb-timeline').childElementCount,0);
  h.node('retry-load').click();await deliver(h,base);
  assert.equal(h.node('acb-status').textContent,'CALCULATED');
  const timeline=h.node('acb-timeline').textContent,formula=h.node('acb-correct-formula').textContent;
  h.node('retry-load').click();await deliver(h,bad);
  assert.equal(h.node('acb-status').textContent,'STALE · LAST VERIFIED');
  assert.equal(h.node('acb-timeline').textContent,timeline);
  assert.equal(h.node('acb-correct-formula').textContent,formula);
});

for(const seller of ['SYN-CAD-TAX','SYN-CAD-TAX-B'])for(const fee of ['0','0.005'])
  for(const price of ['20.00496','20.005','20.00504'])test('Tax Lab narrative accepts exact fractional loss '+seller+' fee '+fee+' price '+price,async()=>{
    const journal=getUnifiedSyntheticJournal();
    const a=journal.events.find(e=>e.type==='buy'&&e.accountId==='SYN-CAD-TAX'&&e.securityId==='SYN-EQUITY-1');
    // Zero purchase fees put the exact pooled average immediately below, at,
    // or above the half cent. Purchase fees are covered independently above.
    a.quantity='10.25';a.unitPrice=price;a.fee='0';
    const b=journal.events.find(e=>e.id==='SYN-R1A-BUY-B');b.unitPrice=price;b.fee='0';
    const sale=journal.events.find(e=>e.id==='SYN-R1A-SELL-A');
    sale.accountId=seller;sale.quantity='5.123456789012';sale.unitPrice='10.000000000001';sale.fee=fee;
    const payload=buildUnifiedSyntheticViews(journal);validateJournalResponse(payload);
    assert.match(payload.taxLab.sale.preliminaryGain,/^-CA\$/);
    assert.equal(payload.taxLab.before.average,price==='20.00496'?'CA$20.00':'CA$20.01');
    assert.equal(payload.taxLab.sale.pooledFormula.includes('selling fee'),fee!=='0');
    const h=await frontendHarness('tax-lab.js','acb-lab.html');await deliver(h,payload);
    assert.equal(h.node('acb-status').textContent,'CALCULATED');
    assert.equal(h.node('acb-sale-gain').textContent,payload.taxLab.sale.preliminaryGain);
    assert.equal(h.node('acb-timeline').childElementCount,3);
  });

const fxContradictions=[
  ['holdings.fx',null],['holdings.fx.rate','1.36'],
  ['holdings.positions.0.marketValueCadEquivalent',null],
  ['holdings.positions.0.marketValueCadEquivalent','1.00'],
  ['holdings.valuationInputs.accounts.0.USD.cash.n','1'],
  ['holdings.valuationInputs.positions.0.marketValue.n','1'],
  ['holdings.valuationInputs.positions.0.marketValue.d','0'],
  ['holdings.valuationInputs',undefined]
];
for(const [path,value] of fxContradictions)test('reject contradictory FX/valuation evidence '+path,()=>{
  const payload=structuredClone(base);setPath(payload,path,value);
  assert.throws(()=>validateJournalResponse(payload),/response rejected/);
});
test('missing FX retains native USD holdings but rejects every invented CAD equivalent or availability flag',()=>{
  const journal=getUnifiedSyntheticJournal();delete journal.valuationFx;
  const valid=buildUnifiedSyntheticViews(journal);validateJournalResponse(valid);
  const usd=valid.holdings.positions.findIndex(p=>p.currency==='USD');
  assert.equal(valid.holdings.positions[usd].marketValueCadEquivalent,null);
  for(const mutate of [
    p=>p.holdings.positions[usd].marketValueCadEquivalent='1.00',
    p=>{p.holdings.cadEquivalent='1.00';p.overview.cadEquivalent='1.00';},
    p=>{p.holdings.valuationState='valued';p.overview.valuationState='valued';},
    p=>p.holdings.fx=structuredClone(base.holdings.fx)
  ]){
    const bad=structuredClone(valid);mutate(bad);assert.throws(()=>validateJournalResponse(bad),/response rejected/);
  }
});
test('tiny foreign cash rounding to zero still requires FX; CAD-only and genuinely empty selections remain valid',()=>{
  for(const currency of ['CAD','USD'])for(const amount of ['0','0.000000000001','100']){
    const journal=getUnifiedSyntheticJournal();delete journal.valuationFx;
    journal.accounts.push({id:'SYN-CASH-CASE',ownerId:'SYN-CASH-OWNER',label:'Fictional cash case',type:'tfsa',currency});
    if(amount!=='0')journal.events.push({id:'SYN-CASH-DEPOSIT',accountId:'SYN-CASH-CASE',date:journal.asOf,seq:1,type:'deposit',currency,amount});
    const payload=buildUnifiedSyntheticViews(journal,{accountIds:['SYN-CASH-CASE']});
    validateJournalResponse(payload,{accountIds:['SYN-CASH-CASE']});
    assert.equal(payload.holdings.valuationState,amount==='0'?'empty':currency==='USD'?'missing-fx':'valued');
    if(currency==='USD'&&amount!=='0'){
      const bad=structuredClone(payload);
      for(const view of [bad.holdings,bad.overview]){view.valuationState='empty';view.cadEquivalent='0.00';view.takeaway.state='empty';}
      assert.throws(()=>validateJournalResponse(bad,{accountIds:['SYN-CASH-CASE']}),/response rejected/);
    }
  }
});
for(const [script,page,total,error] of [...pages,['tax-lab.js','acb-lab.html','acb-before-cost','acb-error']]){
  for(const defect of ['tax gain','missing FX'])test(script+' withholds review counterexample '+defect,async()=>{
    const bad=structuredClone(base);
    if(defect==='tax gain')bad.taxLab.sale.preliminaryGain='CA$999999.00';else bad.holdings.fx=null;
    const h=await frontendHarness(script,page);await deliver(h,bad);
    assert.equal(h.node(total).textContent,'Unavailable');assert.equal(h.node(error).hidden,false);
    if(script==='app.js')assert.doesNotMatch(h.node('overview-fx').textContent,/CAD-only/);
    h.node('retry-load').click();await deliver(h,base);const before=h.node(total).textContent;
    h.node('retry-load').click();await deliver(h,bad);
    assert.equal(h.node(total).textContent,before);assert.equal(h.node(error).hidden,false);
  });
}
test('browser rational module has an explicit read-only no-store route and no arbitrary accounting-file access',async()=>{
  const server=createAppServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  try{
    const response=await fetch(url+'/accounting/rational.mjs');
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);
    assert.equal(response.headers.get('cache-control'),'no-store');assert.match(await response.text(),/export class Q/);
    assert.equal((await fetch(url+'/accounting/ledger.mjs')).status,404);
    assert.equal((await fetch(url+'/accounting/rational.mjs',{method:'POST'})).status,405);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
