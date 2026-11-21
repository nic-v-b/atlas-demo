import {initializeAtlasTheme} from './theme.js';
import {readJournalResponse,InvalidAccountSelection,readSavedAccountSelection} from './journal-response.mjs';
// R1a: default Overview comes from the SAME fictional journal as Holdings
// and Tax Lab. No fabricated historical performance or rule-scenario mix.
const el=id=>document.getElementById(id);
const set=(id,value)=>{el(id).textContent=String(value);};
const colours=['--chart-spruce','--chart-slate','--chart-ochre','--chart-plum','--chart-blue','--chart-olive'];
const researchQuestions={
  review:'Why is cash this high?',
  routine:'What makes up my portfolio?',
  empty:'What is in this account selection?',
  unavailable:'Why is a combined value unavailable?'
};
function format(value,currency='CAD'){
  const amount=Number(value);
  if(!Number.isFinite(amount))throw Error('Invalid synthetic money projection');
  return (amount<0?'-':'')+(currency==='CAD'?'CA$':'US$')+
    Math.abs(amount).toLocaleString('en-CA',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function allocation(rows){
  const bar=el('allocation'),legend=el('legend');
  bar.replaceChildren();legend.replaceChildren();
  if(!Array.isArray(rows)||rows.length===0){
    bar.setAttribute('aria-label','Combined portfolio composition unavailable');
    const note=document.createElement('p');
    note.textContent='No comparable combined portfolio weights are available.';
    legend.append(note);return;
  }
  let sum=0;
  for(const [i,r] of rows.entries()){
    if(!Number.isFinite(r.percentOfPortfolio)||r.percentOfPortfolio<0||
       r.percentOfPortfolio>100)throw Error('Invalid synthetic composition percentage');
    const pct=r.percentOfPortfolio;sum+=pct;
    const colour='var('+colours[i%colours.length]+')';
    const segment=document.createElement('div');
    segment.style.width=pct+'%';segment.style.background=colour;
    segment.title=r.label+': '+format(r.valueCad)+' · '+pct.toFixed(1)+'%';
    bar.append(segment);
    const item=document.createElement('div');item.className='legend-item';
    const dot=document.createElement('i');dot.style.background=colour;
    const name=document.createElement('span');name.textContent=r.label;
    const value=document.createElement('b');
    value.textContent=format(r.valueCad)+' · '+pct.toFixed(1)+'%';
    item.append(dot,name,value);legend.append(item);
  }
  if(sum<99||sum>101)throw Error('Non-reconciling synthetic composition');
  bar.setAttribute('aria-label','Fictional portfolio composition; CAD-equivalent amounts and percentages');
}
function render(payload){
  const d=payload.overview,h=payload.holdings,info=h.exposure;
  const t=d.takeaway;
  if(!t||!d.currencyTotals)throw Error('Incomplete synthetic overview');
  el('signal').className='signal '+t.state;
  set('signal',t.state.toUpperCase());
  set('headline',researchQuestions[t.state]??t.title);
  set('summary',t.text);
  set('action',t.state==='review'?'Review allocation in Holdings':
    t.state==='routine'?'No action inferred':
    t.state==='empty'?'No holdings to evaluate':'Verify valuation data');
  set('asof',d.asOf);
  set('overview-selection',h.accountCount+' of '+h.accountOptions.length+' fictional accounts selected');
  set('native-cad',format(d.currencyTotals.CAD.total));
  set('native-usd',format(d.currencyTotals.USD.total,'USD'));
  set('overview-total',d.cadEquivalent===null?'Unavailable':format(d.cadEquivalent));
  const emptyValue=d.valuationState==='empty'?format(d.cadEquivalent):'Unavailable';
  set('overview-cash',info?format(info.cashValueCad):emptyValue);
  set('overview-invested',info?format(info.investedValueCad):emptyValue);
  set('overview-fx',h.fx
    ?'Fictional valuation: 1 USD = '+h.fx.rate+' CAD · dated '+h.fx.asOf+
      '. Convert the USD balance at this rate, then add the CAD balance.'
    :d.valuationState==='missing-fx'?'Combined valuation unavailable without same-date FX.'
    :'CAD-only valuation; currency totals retain native units.');
  const tech=info?.dimensions?.sector?.find(r=>r.key==='technology')??null;
  const geo=d.exposureSummary?.largestGeography??null;
  set('tech',tech?tech.percentOfPortfolio.toFixed(1)+'%':'—');
  set('techfoot',tech?'Share of total, including cash':'Exposure cannot be inferred');
  set('issuer',geo?geo.percentOfPortfolio.toFixed(1)+'%':'—');
  set('issuerfoot',geo?geo.label+' · share of total':'Geographic exposure unavailable');
  set('decision',t.state==='review'?'Review':
    t.state==='routine'?'No action':
    t.state==='empty'?'Empty':'Unavailable');
  el('techbar').style.width=tech?tech.percentOfPortfolio+'%':'0%';
  el('issuerbar').style.width=geo?geo.percentOfPortfolio+'%':'0%';
  allocation(info?.dimensions?.vehicle??null);
  const evidence=el('evidence');evidence.replaceChildren();
  for(const line of [
    t.evidence,
    'One synthetic journal: '+payload.journalId+' · '+d.asOf,
    'Selected Holdings and Overview reconcile to '+(d.cadEquivalent===null?'no combined value':format(d.cadEquivalent)),
    'Tax Lab uses the complete eligible taxable owner scope, independently of selected account filters.',
    payload.limitations
  ]){
    const li=document.createElement('li');li.textContent=line;
    evidence.append(li);
  }
}
function errorState(){
  set('signal','DATA UNAVAILABLE');el('signal').className='signal unavailable';
  set('headline','Portfolio evidence unavailable');
  set('summary','The unified fictional journal could not be verified. No portfolio conclusion is inferred.');
  for(const id of ['tech','issuer','native-cad','native-usd','overview-total','overview-cash','overview-invested'])set(id,'Unavailable');
  for(const id of ['techfoot','issuerfoot','overview-fx'])set(id,'No verified synthetic projection.');
  set('decision','Unavailable');set('action','No action inferred');set('asof','—');
  set('overview-selection','Selection unavailable');
  el('techbar').style.width='0%';el('issuerbar').style.width='0%';
  allocation(null);
  el('evidence').replaceChildren();
}
let requestCounter=0,committedView=null;
let selected=readSavedAccountSelection(()=>sessionStorage),committedSelection=null;
async function load(){
  const request=++requestCounter;
  try{
    const ids=readSavedAccountSelection(()=>sessionStorage,{fallback:committedSelection??selected});
    selected=ids;
    if(ids!==null&&ids.length===0)throw new InvalidAccountSelection('Saved fictional account selection is invalid. Choose accounts in Holdings.');
    const qs=ids===null?'':'?accounts='+encodeURIComponent(ids.join(','));
    const response=await fetch('/api/r1a/state'+qs,{cache:'no-store'});
    const payload=await readJournalResponse(response,{accountIds:ids});
    if(request!==requestCounter)return;
    render(payload);committedView=payload;
    committedSelection=payload.holdings.selectedAccountIds.slice();
    el('overview-error').hidden=true;
  }catch(error){
    if(request!==requestCounter)return;
    if(committedView)render(committedView);else errorState();
    if(committedView){set('signal','STALE');el('signal').className='signal unavailable';set('action','Refresh to verify current evidence');}
    el('overview-error').hidden=false;
    set('overview-error',error instanceof InvalidAccountSelection?error.message:
      committedView?'Unable to refresh. Showing the last verified snapshot and its account selection; figures may be stale.':
      'Unable to verify the fictional journal. Your account selection has been retained. Retry or change selection in Holdings.');
  }
}
el('retry-load').addEventListener('click',load);
initializeAtlasTheme();
load();
