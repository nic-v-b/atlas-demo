import {initializeAtlasTheme} from './theme.js';
import {readJournalResponse,InvalidAccountSelection,readSavedAccountSelection} from './journal-response.mjs';
// Only fictional values from local, GET-only, deterministic ATLAS APIs.
// No real financial input, persistence, external URLs, or network third parties.
const el=id=>document.getElementById(id);
const displayMoney=(amount,c)=>{
  const n=Number(amount),prefix=c==='CAD'?'CA$':'US$';
  if(!Number.isFinite(n))throw Error('Invalid fictional currency amount');
  return (n<0?'-':'')+prefix+
    Math.abs(n).toLocaleString('en-CA',{minimumFractionDigits:2,maximumFractionDigits:2});
};
// Whole-dollar summary in the donut center only; full precision elsewhere.
const displayWholeCad=(amount)=>{
  const value=Number(amount);
  if(!Number.isFinite(value))throw Error('Invalid fictional CAD amount');
  return 'CA$'+value.toLocaleString('en-CA',{minimumFractionDigits:0,maximumFractionDigits:0});
};
const exposurePalette=['spruce','ochre','slate','plum','blue','olive','sand','teal','rose','grey'];
const exposureViews=['vehicle','strategy','sector','geography'];
const valueModes=['money','percent','both'];
function exposureLabel(amount,pct){
  const money=displayMoney(amount,'CAD');
  const percentage=pct===null?'—':pct.toFixed(1)+'%';
  return exposureValueMode==='money'?money:
    exposureValueMode==='percent'?percentage:money+' · '+percentage;
}
const sectorColours={
  healthcare:'ochre',technology:'spruce',financials:'slate',
  industrials:'plum',consumer:'teal',other:'olive',
  energy:'sand',utilities:'violet',communications:'blue',
  materials:'gold','real-estate':'rose',unclassified:'grey'
};
const chartColour=colour=>'var(--chart-'+colour+')';
const sectorColour=key=>chartColour(sectorColours[key]??'grey');

let activeExposure='vehicle';
let exposureValueMode='both'; // Rendering preference only; never alters exact accounting.
let currentExposure=null;
let currentValuationState='loading';
// Synthetic-only selection continuity across the Overview/Holdings pages.
// R1b must replace browser state before any genuine account identifiers exist.
const SELECTION_KEY='atlas-synthetic-account-selection-v1';
function saveSelection(ids){
  try{
    if(Array.isArray(ids)&&ids.every(id=>/^SYN-[A-Z0-9-]{2,64}$/.test(id)))
      sessionStorage.setItem(SELECTION_KEY,JSON.stringify(ids));
  }catch{/* Optional browser session storage; no financial values stored */}
}
let selected=readSavedAccountSelection(()=>sessionStorage);
let committedView=null;
let accountOptions=null;
let requestCounter=0;
const text=(id,v)=>{el(id).textContent=v;};
function addText(parent,tag,body,className){
  const child=document.createElement(tag);
  child.textContent=body;
  if(className)child.className=className;
  parent.append(child);
  return child;
}
function refreshButtons(){
  if(!accountOptions)return;
  for(const button of el('account-filters').querySelectorAll('button[data-account]')){
    const on=selected.includes(button.dataset.account);
    button.setAttribute('aria-pressed',String(on));
    button.querySelector('.h-check').textContent=on?'☑':'□';
  }
}
function renderFilters(){
  if(el('account-filters').childElementCount)return refreshButtons();
  for(const a of accountOptions){
    const button=document.createElement('button');
    button.type='button';button.className='h-filter-btn';
    button.dataset.account=a.id;
    button.setAttribute('aria-pressed','true');
    const check=addText(button,'span','☑','h-check');
    check.setAttribute('aria-hidden','true');
    const details=document.createElement('span');
    addText(details,'b',a.label);
    addText(details,'small',a.type.toUpperCase()+' · Base '+a.baseCurrency);
    button.append(details);
    button.addEventListener('click',()=>{
      const next=selected.includes(a.id)
        ?selected.filter(id=>id!==a.id)
        :accountOptions.filter(x=>selected.includes(x.id)||x.id===a.id).map(x=>x.id);
      if(next.length===0){
        showError('Select at least one fictional account.');return;
      }
      selected=next;refreshButtons();load().catch(showError);
    });
    el('account-filters').append(button);
  }
  refreshButtons();
}

function drawSectorVisuals(exposure){
  const donut=el('h-sector-donut'),key=el('h-sector-key');
  key.replaceChildren();
  donut.style.background='var(--stroke)';
  const items=exposure?.dimensions?.sector?.filter(r=>r.key!=='cash'&&r.percentOfInvested!==null)??[];
  const invested=Number(exposure?.investedValueCad??0);
  if(!Number.isFinite(invested)||invested<=0||!items.length){
    text('h-sector-focus-label','NOT AVAILABLE');
    text('h-sector-focus-value','—');
    addText(key,'p','Invested sector exposures cannot be calculated without verified, comparable amounts.');
    donut.setAttribute('aria-label','Sector distribution unavailable');
    return;
  }
  const sumPercent=items.reduce((n,item)=>n+item.percentOfInvested,0);
  if(Math.abs(sumPercent-100)>1)throw Error('Sector chart weights do not reconcile');
  let start=0;
  const slices=[];
  for(let i=0;i<items.length;i++){
    const item=items[i];
    if(!Number.isFinite(item.percentOfInvested)||item.percentOfInvested<0||item.percentOfInvested>100)
      throw Error('Invalid sector chart weight');
    const end=i===items.length-1?100:Math.min(100,start+item.percentOfInvested);
    const color=sectorColour(item.key);
    slices.push(color+' '+start.toFixed(3)+'% '+end.toFixed(3)+'%');
    start=end;
  }
  donut.style.background='conic-gradient('+slices.join(',')+')';
  donut.setAttribute('aria-label','Illustrative invested sector distribution: '+
    items.map(i=>i.label+' '+i.percentOfInvested.toFixed(1)+' percent').join('; '));
  const reset=()=>{
    text('h-sector-focus-label','INVESTED ASSETS');
    text('h-sector-focus-value',exposureValueMode==='percent'?'100%':displayWholeCad(exposure.investedValueCad));
  };
  const show=(item,activeButton)=>{
    text('h-sector-focus-label',item.label.toUpperCase());
    text('h-sector-focus-value',exposureValueMode==='money'?displayWholeCad(item.valueCad):item.percentOfInvested.toFixed(1)+'%');
    for(const button of key.querySelectorAll('button')){
      button.setAttribute('aria-pressed',String(button===activeButton));
    }
  };
  reset();
  for(const item of items){
    const button=document.createElement('button');
    button.type='button';
    button.setAttribute('aria-pressed','false');
    button.setAttribute('aria-label',item.label+': '+item.percentOfInvested.toFixed(1)+
      '% of invested holdings; '+displayMoney(item.valueCad,'CAD'));
    const dot=document.createElement('i');
    dot.style.background=sectorColour(item.key);
    dot.setAttribute('aria-hidden','true');
    addText(button,'span',item.label);
    button.prepend(dot);
    addText(button,'b',exposureLabel(item.valueCad,item.percentOfInvested));
    button.addEventListener('click',()=>show(item,button));
    button.addEventListener('focus',()=>show(item,button));
    key.append(button);
  }

}
function drawTargetComparison(exposure){
  const container=el('h-target-bars');
  container.replaceChildren();
  const comparison=exposure?.exampleSectorComparison;
  if(!comparison||!Array.isArray(comparison.rows)){
    addText(container,'p','Comparison unavailable. Full classified invested holdings and a valid fictional target policy are required.');
    text('h-target-note','No allocation gap is inferred without complete classifications and an explicit target.');
    return;
  }
  const rows=comparison.rows;
  const maxVal=Math.max(...rows.flatMap(r=>[r.actualPct,r.targetPct]),0);
  const scale=Math.max(10,Math.min(100,Math.ceil(maxVal/10)*10));
  for(const r of rows){
    if(!Number.isFinite(r.actualPct)||!Number.isFinite(r.targetPct)||!Number.isFinite(r.deltaPp))
      throw Error('Invalid target drift chart data');
    const row=document.createElement('div');row.className='h-target-row';
    row.setAttribute('role','group');
    row.setAttribute('aria-label',r.label+': current '+r.actualPct.toFixed(1)+
      ' percent; demo target '+r.targetPct.toFixed(1)+' percent; difference '+
      (r.deltaPp>=0?'+':'')+r.deltaPp.toFixed(1)+' percentage points');
    const head=document.createElement('div');head.className='h-target-row-head';
    addText(head,'b',r.label);
    addText(head,'strong',r.actualPct.toFixed(1)+'%');
    row.append(head);
    const track=document.createElement('div');track.className='h-target-track';
    const fill=document.createElement('div');fill.className='h-target-fill';
    fill.style.width=Math.min(100,r.actualPct/scale*100)+'%';
    fill.style.background=sectorColour(r.key);
    track.append(fill);
    const marker=document.createElement('div');marker.className='h-target-marker';
    marker.style.left=Math.min(100,r.targetPct/scale*100)+'%';
    marker.setAttribute('aria-hidden','true');
    track.append(marker);row.append(track);
    const foot=document.createElement('div');foot.className='h-target-row-foot';
    addText(foot,'span','Example target '+r.targetPct.toFixed(1)+'%');
    const direction=r.deltaPp>0?'Above':r.deltaPp<0?'Below':'On';
    addText(foot,'strong',direction+' by '+Math.abs(r.deltaPp).toFixed(1)+' pp');
    row.append(foot);
    container.append(row);
  }
  text('h-target-note','All bars use a common 0–'+scale+
    '% of invested holdings scale. These targets are invented for demonstration, not recommendations or a market benchmark. “Above” and “below” describe differences, not buy/sell instructions.');
}

function drawExposure(exposure){
  const bar=el('h-allocation'),legend=el('h-legend'),etfMix=el('h-etf-mix');
  bar.replaceChildren();legend.replaceChildren();etfMix.replaceChildren();
  for(const tab of document.querySelectorAll('[data-exposure]')){
    const active=tab.dataset.exposure===activeExposure;
    tab.setAttribute('aria-selected',String(active));
    tab.tabIndex=active?0:-1;
  }
  el('h-exposure-panel').setAttribute('aria-labelledby','tab-'+activeExposure);
  if(!exposure){
    if(currentValuationState!=='missing-fx'){
      const empty=currentValuationState==='empty';
      const message=empty?'This selection is empty: no cash or positions.':'Portfolio figures are unavailable.';
      bar.setAttribute('aria-label',message);
      addText(legend,'p',message);
      addText(etfMix,'p',empty?'No ETF holdings in this empty selection.':message);
      drawSectorVisuals(null);
      drawTargetComparison(null);
      text('h-target-bars',empty?'No invested holdings to compare.':message);
      text('h-target-note',empty?'Target differences are undefined for an empty portfolio.':message);
      text('h-coverage',empty?'No invested holdings to classify.':message);
      text('allocation-note',empty?'Portfolio weights are undefined for an empty selection.':message);
      return;
    }
    bar.setAttribute('aria-label','Unavailable: mixed-currency portfolio without valid as-of FX');
    addText(legend,'p','Exposure requires a date-matched CAD valuation rate.');
    addText(etfMix,'p','ETF breakdown is unavailable without a comparable valuation.');
    drawSectorVisuals(null);
    drawTargetComparison(null);
    text('h-coverage','No combined exposure is calculated without a valid same-date FX rate.');
    text('allocation-note','CAD and USD remain separate. Do not infer relative weights from different currencies.');
    return;
  }
  if(exposure.synthetic!==true||!exposure.dimensions)throw Error('Invalid synthetic exposure projection');
  const items=exposure.dimensions[activeExposure];
  if(!Array.isArray(items))throw Error('Unrecognized exposure dimension');
  let approximateTotal=0;
  for(const [i,item] of items.entries()){
    const pct=item.percentOfPortfolio;
    if(typeof pct!=='number'||!Number.isFinite(pct)||pct<0||pct>100)
      throw Error('Invalid synthetic exposure weight');
    approximateTotal+=pct;
    const colour=activeExposure==='sector'?sectorColour(item.key):
      chartColour(exposurePalette[i%exposurePalette.length]);
    const segment=document.createElement('div');
    segment.style.width=pct+'%';segment.style.background=colour;
    segment.title=item.label+': '+pct.toFixed(1)+'% of total';
    bar.append(segment);
    const row=document.createElement('div');row.className='h-exposure-row';
    const dot=document.createElement('i');dot.className='h-dot';dot.style.background=colour;
    row.append(dot);
    const middle=document.createElement('div');
    addText(middle,'b',item.label);
    const invested=item.percentOfInvested===null
      ?'Cash or uninvested'
      :item.percentOfInvested.toFixed(1)+'% of invested holdings';
    addText(middle,'small',invested);
    row.append(middle);
    addText(row,'strong',exposureLabel(item.valueCad,pct));
    legend.append(row);
  }
  if(approximateTotal<99||approximateTotal>101)throw Error('Composition does not sum to whole portfolio');
  bar.setAttribute('aria-label','Fictional '+activeExposure+
    ' look-through including cash; approximate percentages of total CAD-equivalent value');
  if(!exposure.etfMix.length){
    addText(etfMix,'p','No ETF holdings in this account selection.');
  }else{
    for(const entry of exposure.etfMix){
      const row=document.createElement('div');row.className='h-etf-row';
      const info=document.createElement('div');
      addText(info,'b',entry.label);
      addText(info,'small',exposureLabel(entry.valueCad,entry.percentOfPortfolio)+' of total portfolio');
      row.append(info);
      addText(row,'strong',entry.percentOfEtfs.toFixed(1)+'% of ETFs');
      etfMix.append(row);
    }
  }
  drawSectorVisuals(exposure);
  drawTargetComparison(exposure);
  const sectorCoverage=exposure.coverage.sectorPctOfInvested;
  const geographyCoverage=exposure.coverage.geographyPctOfInvested;
  if(sectorCoverage===null||geographyCoverage===null){
    text('h-coverage','Sector and geographic classification coverage is unavailable: this fictional selection has no invested holdings.');
  }else{
    text('h-coverage','Illustrative classification coverage: sectors '+
      sectorCoverage.toFixed(1)+'%, geography '+geographyCoverage.toFixed(1)+
      '% of invested holdings. These are manually invented weights, not verified ETF constituents or issuer overlap.');
  }
  text('allocation-note','Fictional manual look-through · '+exposure.asOf+
    '. Every tab is an alternative breakdown of the same selected portfolio; percentages are rounded and include cash.');
}
for(const button of document.querySelectorAll('[data-value-mode]')){
  button.addEventListener('click',()=>{
    if(!valueModes.includes(button.dataset.valueMode))return;
    exposureValueMode=button.dataset.valueMode;
    for(const item of document.querySelectorAll('[data-value-mode]')){
      item.setAttribute('aria-pressed',String(item.dataset.valueMode===exposureValueMode));
    }
    drawExposure(currentExposure);
  });
}
for(const tab of document.querySelectorAll('[data-exposure]')){
  tab.addEventListener('click',()=>{
    activeExposure=tab.dataset.exposure;
    drawExposure(currentExposure);
  });
  tab.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const idx=exposureViews.indexOf(activeExposure);
    const next=event.key==='Home'?0:event.key==='End'?exposureViews.length-1:
      (idx+(event.key==='ArrowRight'?1:-1)+exposureViews.length)%exposureViews.length;
    activeExposure=exposureViews[next];
    drawExposure(currentExposure);
    el('tab-'+activeExposure).focus();
  });
}
function drawAccountDetails(accounts){
  const out=el('h-account-details');out.replaceChildren();
  for(const account of accounts){
    const row=document.createElement('div');row.className='h-account-row';
    addText(row,'b',account.label);
    addText(row,'small',account.type.toUpperCase()+' · '+account.baseCurrency+' base');
    for(const c of ['CAD','USD']){
      if(Number(account.pockets[c].total)===0)continue;
      const pocket=document.createElement('div');pocket.className='h-account-pocket';
      addText(pocket,'span',c+' cash + positions');
      addText(pocket,'strong',displayMoney(account.pockets[c].total,c));
      row.append(pocket);
    }
    out.append(row);
  }
}
function drawPositions(positions){
  const body=el('h-position-rows');body.replaceChildren();
  text('positions-title',positions.length+' positions by account');
  if(!positions.length){
    const row=document.createElement('tr');
    const cell=document.createElement('td');cell.colSpan=8;
    cell.textContent='No open positions in the selected fictional accounts.';
    row.append(cell);body.append(row);return;
  }
  for(const p of positions){
    const row=document.createElement('tr');
    const main=document.createElement('th');
    main.setAttribute('scope','row');
    addText(main,'span',p.symbol,'h-symbol');
    addText(main,'span',p.name,'h-sub');
    row.append(main);
    const account=addText(row,'td',p.accountLabel);
    addText(account,'span',p.accountType.toUpperCase(),'h-sub');
    const cols=[
      p.quantity,
      displayMoney(p.unitQuote,p.currency),
      displayMoney(p.bookValueNative,p.currency),
      displayMoney(p.marketValueNative,p.currency),
      p.marketValueCadEquivalent===null?'Unavailable':displayMoney(p.marketValueCadEquivalent,'CAD'),
      displayMoney(p.unrealizedNative,p.currency)
    ];
    for(let i=0;i<cols.length;i++){
      const cell=addText(row,'td',cols[i],'num');
      if(i===5){
        cell.classList.add(Number(p.unrealizedNative)<0?'h-pnl-negative':'h-pnl-positive');
      }
    }
    body.append(row);
  }
}
function render(d){
  if(d.synthetic!==true||d.taxReady!==false||!d.currencyTotals)throw Error('Rejected non-synthetic view model');
  if(JSON.stringify(accountOptions)!==JSON.stringify(d.accountOptions))el('account-filters').replaceChildren();
  accountOptions=d.accountOptions;
  selected=d.selectedAccountIds.slice();
  renderFilters();
  text('asof',d.asOf);
  text('selected-count',d.accountCount+' selected account'+(d.accountCount===1?'':'s'));
  text('cad-equivalent',d.cadEquivalent===null?'Unavailable':displayMoney(d.cadEquivalent,'CAD'));
  text('fx-note',d.fx
    ?'Fictional conversion: 1 '+d.fx.from+' = '+d.fx.rate+' '+d.fx.to+' · as of '+d.fx.asOf
    :d.valuationState==='empty'?'No currency conversion is needed for zero native balances.'
    :d.valuationState==='valued'?'No currency conversion is needed for this CAD-only valuation.'
    :'No same-date valuation FX rate; CAD and USD are shown separately.');
  for(const c of ['CAD','USD']){
    const k=c.toLowerCase(),tot=d.currencyTotals[c];
    text(k+'-total',displayMoney(tot.total,c));
    text(k+'-cash',displayMoney(tot.cash,c));
    text(k+'-positions',displayMoney(tot.positionValue,c));
  }
  text('insight-state',d.takeaway.state.toUpperCase());
  text('insight-title',d.takeaway.title);
  text('insight-text',d.takeaway.text);
  text('insight-evidence',d.takeaway.evidence);
  currentExposure=d.exposure;
  currentValuationState=d.valuationState;
  drawExposure(currentExposure);
  drawAccountDetails(d.perAccount);
  drawPositions(d.positions);
  el('h-error').hidden=true;
}
function showError(e){
  const message=typeof e==='string'?e:'Unable to display the fictional portfolio. Verify the local test server and fixture.';
  el('h-error').hidden=false;
  el('h-error').textContent=message;
}
function withholdPortfolio(){
  currentExposure=null;currentValuationState='unavailable';
  accountOptions=null;el('account-filters').replaceChildren();text('asof','—');
  for(const id of ['cad-equivalent','cad-total','cad-cash','cad-positions','usd-total','usd-cash','usd-positions'])text(id,'Unavailable');
  text('selected-count','Account selection unavailable');
  text('fx-note','No portfolio figures have been verified.');
  text('insight-state','UNAVAILABLE');text('insight-title','Portfolio figures unavailable');
  text('insight-text','The fictional portfolio could not be loaded.');text('insight-evidence','—');
  text('positions-title','Positions unavailable');
  const row=document.createElement('tr'),cell=addText(row,'td','Portfolio figures are unavailable.');
  cell.colSpan=8;el('h-position-rows').replaceChildren(row);
  el('h-account-details').replaceChildren();
  drawExposure(null);
}
async function load(){
  const request=++requestCounter;
  el('account-filters').setAttribute('aria-busy','true');
  text('selected-count','Updating account selection…');
  try{
    if(selected!==null&&selected.length===0)throw new InvalidAccountSelection('Saved fictional account selection is invalid. Choose valid fictional accounts in Holdings.');
    const requestedIds=selected===null?null:selected.slice();
    const qs=requestedIds===null?'':'?accounts='+encodeURIComponent(requestedIds.join(','));
    const response=await fetch('/api/r1a/state'+qs,{cache:'no-store'});
    const payload=await readJournalResponse(response,{accountIds:requestedIds});
    if(request!==requestCounter)return;
    const d=payload.holdings;
    render(d);
    committedView=d;
    saveSelection(d.selectedAccountIds);
  }catch(error){
    // Obsolete requests may fail after a newer account selection succeeds.
    // An older failure must never overwrite the newest valid UI state.
    if(request!==requestCounter)return;
    // Pending buttons must return to the selection behind the rendered figures.
    if(committedView)render(committedView);
    else withholdPortfolio();
    if(committedView)text('asof',committedView.asOf+' · last verified; refresh failed');
    showError(error instanceof InvalidAccountSelection?error.message+(committedView?' Showing the last verified snapshot; figures may be stale.':' Use Select all to explicitly choose all fictional accounts.'):
      committedView?'Unable to update the fictional portfolio. The last verified snapshot and account selection have been restored; figures may be stale.':
      'Unable to verify the fictional portfolio. Your account selection has been retained. Retry to request the same selection.');
  }finally{
    if(request===requestCounter)el('account-filters').setAttribute('aria-busy','false');
  }
}
el('select-all').addEventListener('click',()=>{
  selected=accountOptions?accountOptions.map(x=>x.id):null;
  refreshButtons();
  load().catch(showError);
});
el('retry-load').addEventListener('click',()=>load().catch(showError));
initializeAtlasTheme();
load().catch(showError);
