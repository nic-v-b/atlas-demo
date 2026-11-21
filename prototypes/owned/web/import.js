import {parseSyntheticSnapshot,snapshotView,ACCOUNTS,MAX_CSV_BYTES,CsvError} from './synthetic-csv.mjs';
import {initializeAtlasTheme} from './theme.js';

const el=id=>document.getElementById(id);
const text=(id,value)=>{el(id).textContent=value;};
const amount=(value,currency)=>value===null?'Unavailable':(currency==='CAD'?'CA$':'US$')+value;
const percent=value=>value===null?'Unavailable':value+'%';
let snapshot=null,selected=null,confirmed=false,generation=0;
function reset(message){
  generation++;snapshot=null;selected=null;confirmed=false;
  el('portfolio').hidden=true;el('confirm').disabled=true;
  for(const id of ['import-accounts','import-rows','account-totals'])el(id).replaceChildren();
  for(const id of ['import-total','import-fx','import-cad','import-usd','snapshot-date','reconciliation','unavailable'])text(id,'');
  el('import-error').hidden=true;text('import-error','');text('import-status',message);
}
function enable(){el('preview').disabled=!(el('fictional').checked&&el('csv-file').files?.length===1);}
function render(){
  const view=snapshotView(snapshot,selected);
  text('snapshot-heading',confirmed?'Reconciled snapshot holdings':'Portfolio preview · not yet confirmed');
  text('snapshot-date','AS OF '+view.asOf);text('import-total',amount(view.cadEquivalent,'CAD'));
  text('import-cad',amount(view.currencyTotals.CAD,'CAD'));text('import-usd',amount(view.currencyTotals.USD,'USD'));
  text('import-fx',view.usdToCad===null?'No USD → CAD rate supplied. Mixed-currency totals stay separate.':'Fictional dated FX: 1 USD = '+view.usdToCad+' CAD');
  text('reconciliation',view.reconciliation);text('unavailable',view.unavailable.join(' · ')+' — unavailable from a holdings snapshot.');
  const accounts=el('import-accounts');accounts.replaceChildren();
  for(const id of new Set(snapshot.rows.map(r=>r.accountId))){
    const button=document.createElement('button');button.type='button';button.className='h-filter-btn';
    button.textContent=ACCOUNTS[id].label;button.setAttribute('aria-pressed',String(view.selected.includes(id)));
    button.addEventListener('click',()=>{
      const next=view.selected.includes(id)?view.selected.filter(x=>x!==id):[...view.selected,id];
      if(next.length===0){text('import-status','Keep at least one account selected.');return;}
      selected=next;render();
    });accounts.append(button);
  }
  const totals=el('account-totals');totals.replaceChildren();
  for(const a of view.accounts){const p=document.createElement('p');p.textContent=ACCOUNTS[a.accountId].label+' · '+a.currency+' source total '+amount(a.total,a.currency)+' · matched';totals.append(p);}
  const body=el('import-rows');body.replaceChildren();
  for(const r of view.positions){
    const tr=document.createElement('tr');
    const values=[r.securityId+' · '+r.name+' · '+r.exchange,ACCOUNTS[r.accountId].label+' · '+r.accountType,
      r.currency,r.quantity,r.unitPrice,amount(r.marketValue,r.currency),amount(r.cadEquivalent,'CAD'),percent(r.nativePercent),percent(r.portfolioPercent)];
    for(const [i,value] of values.entries()){const td=document.createElement('td');td.textContent=value;if(i>=3)td.className='num';tr.append(td);}
    body.append(tr);
  }
  el('portfolio').hidden=false;
}
el('csv-file').addEventListener('change',()=>{reset('File selection changed. Validate the new fictional snapshot.');enable();});
el('fictional').addEventListener('change',()=>{reset('Confirm that the file contains invented data, then validate.');enable();});
el('preview').addEventListener('click',async()=>{
  reset('Validating fictional snapshot…');const current=generation;
  const file=el('csv-file').files?.[0];
  el('preview').disabled=true;
  try{
    if(!el('fictional').checked||!file)throw new CsvError('FICTIONAL_CONFIRMATION');
    if(file.size>MAX_CSV_BYTES)throw new CsvError('FILE_SIZE');
    const content=await file.text();
    if(current!==generation)return;
    snapshot=parseSyntheticSnapshot(content);render();el('confirm').disabled=false;
    text('import-status','Validation passed. Review all account totals, then show reconciled holdings.');
  }catch(error){
    if(current!==generation)return;
    const code=error instanceof CsvError?error.code:'FILE_READ';
    text('import-error','Unable to preview: '+code+(error instanceof CsvError&&error.row?' · CSV row '+error.row:'')+'. Use the documented fictional format.');
    el('import-error').hidden=false;text('import-status','No snapshot loaded. Fix the fictional file and validate again.');
  }finally{if(current===generation)enable();}
});
el('confirm').addEventListener('click',()=>{
  if(!snapshot)return;confirmed=true;selected=null;render();el('confirm').disabled=true;
  text('import-status','Reconciled holdings shown. Account filters affect this snapshot only. Clear or select another fictional file to replace it.');
});
el('clear').addEventListener('click',()=>{reset('Snapshot cleared. Nothing has been saved.');el('csv-file').value='';el('fictional').checked=false;enable();});
// Page departure, including the back-forward cache, must not retain a snapshot.
window.addEventListener('pagehide',()=>{reset('Snapshot cleared on page departure.');el('csv-file').value='';el('fictional').checked=false;enable();});
initializeAtlasTheme();enable();
