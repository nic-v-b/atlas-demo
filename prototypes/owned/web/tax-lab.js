import {initializeAtlasTheme} from './theme.js';
import {readJournalResponse} from './journal-response.mjs';
// All figures originate in the shared canonical synthetic journal and deterministic R0f ACB oracle.
// No user monetary inputs, storage, broker API or remote research service.
const el=id=>document.getElementById(id);
const set=(id,v)=>{el(id).textContent=String(v);};
function render(d){
  set('acb-before-units',d.before.units);
  set('acb-before-cost',d.before.cost);
  set('acb-before-average',d.before.average);
  set('acb-sale-gain',d.sale.preliminaryGain);
  set('acb-sale-caption',d.sale.quantity+' sold for '+d.sale.unitPrice+' each');
  for(let i=0;i<2;i++){
    const id=i===0?'a':'b',row=d.accounts[i];
    set('acb-'+id+'-label',row.label);
    set('acb-'+id+'-detail',row.detail);
    set('acb-'+id+'-cost',row.cost);
    set('acb-'+id+'-pct','Account '+row.letter+': '+row.pct.toFixed(1)+'%');
    el('acb-'+id+'-bar').style.width=row.pct+'%';
  }
  el('acb-cost-bar').setAttribute('aria-label',
    'Fictional purchase cost: account A '+d.accounts[0].pct.toFixed(1)+
    ' percent; account B '+d.accounts[1].pct.toFixed(1)+' percent');
  set('acb-sale-title','Sell '+d.sale.quantity+' shares from account '+d.sale.accountLetter);
  set('acb-naive',d.sale.accountOnlyGain);
  set('acb-naive-formula',d.sale.accountOnlyFormula);
  set('acb-correct',d.sale.preliminaryGain);
  set('acb-correct-formula',d.sale.pooledFormula);
  set('acb-after-desc','After the sale, '+d.after.units+
    ' taxable shares remain with '+d.after.cost+' pooled ACB ('+
    d.after.average+' per share). This is a preliminary calculation, not a tax return.');
  const timeline=el('acb-timeline');timeline.replaceChildren();
  for(let i=0;i<d.timeline.length;i++){
    const step=d.timeline[i],li=document.createElement('li');
    const marker=document.createElement('span');marker.className='acb-step';
    marker.textContent=String(i+1).padStart(2,'0');
    const content=document.createElement('div');
    const name=document.createElement('b');
    name.textContent=step.date+' · '+step.title;
    const description=document.createElement('p');
    description.textContent=step.detail;
    content.append(name,description);li.append(marker,content);timeline.append(li);
  }
  set('acb-status','CALCULATED');
  el('acb-error').hidden=true;
}
function withhold(){
  for(const name of ['before-units','before-cost','before-average','sale-gain','sale-caption',
    'a-label','a-detail','a-cost','a-pct','b-label','b-detail','b-cost','b-pct',
    'sale-title','naive','naive-formula','correct','correct-formula','after-desc'])set('acb-'+name,'Unavailable');
  for(const letter of ['a','b'])el('acb-'+letter+'-bar').style.width='0%';
  el('acb-cost-bar').setAttribute('aria-label','Purchase cost proportions unavailable');
  el('acb-timeline').replaceChildren();
}
let requestCounter=0,committedView=null;
async function load(){
  const request=++requestCounter;
  try{
    const res=await fetch('/api/r1a/state',{cache:'no-store'});
    const payload=await readJournalResponse(res);
    if(request!==requestCounter)return;
    render(payload.taxLab);committedView=payload.taxLab;
  }catch{
    if(request!==requestCounter)return;
    if(committedView)render(committedView);else withhold();
    set('acb-status',committedView?'STALE · LAST VERIFIED':'DATA UNAVAILABLE');
    const e=el('acb-error');e.hidden=false;
    e.textContent=committedView?'Unable to refresh. Showing the complete last verified Tax Lab snapshot; figures may be stale.':
      'The shared synthetic journal ACB calculation could not be verified. No monetary or tax interpretation is available.';
  }
}
el('retry-load').addEventListener('click',load);
initializeAtlasTheme();
load();
