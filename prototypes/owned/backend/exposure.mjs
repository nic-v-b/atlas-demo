import {Q} from '../accounting/rational.mjs';

// Fictional, manually classified look-through exposure for the synthetic
// Holdings demonstration. Never infer real ETF constituents from tickers.
// Separate independent dimensions; do not add sector + geography percentages.
const Z=Q.zero(), HUNDRED=Q.of('100');
const vehicleNames={
  etf:'ETFs',fund:'Mutual funds',equity:'Individual stocks',
  cdr:'CAD depositary receipts',cash:'Cash'
};
const strategyNames={
  'global-diversified-etf':'Global diversified ETF',
  'technology-sector-etf':'Technology-focused ETF',
  'other-etf':'Other ETF mandate',
  'direct-financial-stock':'Direct Canadian financial stock',
  'direct-healthcare-stock':'Direct US healthcare stock',
  'cdr-technology':'Technology-linked CAD receipt',
  'unclassified':'Unclassified investment',
  cash:'Cash'
};
const sectorNames={
  technology:'Technology',financials:'Financials',healthcare:'Health care',
  industrials:'Industrials',consumer:'Consumer',energy:'Energy',
  utilities:'Utilities',communications:'Communications',materials:'Materials',
  'real-estate':'Real estate',other:'Other sectors',
  unclassified:'Unknown sector',cash:'Cash'
};
const geographyNames={
  canada:'Canada',us:'United States',developed:'Other developed markets',
  emerging:'Emerging markets',other:'Other markets',
  unclassified:'Unknown geography',cash:'Cash'
};
const allowExact=(value,label)=>{
  if(!(value instanceof Q))throw Error(label+' must be an exact rational');
  if(value.cmp(Z)<0)throw Error(label+' cannot be negative');
  return value;
};
const add=(map,key,value)=>map.set(key,(map.get(key)??Z).add(value));
const sum=arr=>arr.reduce((a,v)=>a.add(v),Z);
const percentage=(amount,denom)=>denom.cmp(Z)===0?null:
  Number(amount.div(denom).mul(HUNDRED).fixed(1));
const rows=(map,labels,total,invested)=>{
  // Preserve tiny-but-positive cash/exposures when a two-decimal display
  // would round their CAD amounts to 0.00. Filtering is on exact Q values.
  const entries=[...map].filter(([,value])=>value.cmp(Z)>0)
    .sort(([aKey,aVal],[bKey,bVal])=>bVal.cmp(aVal)||labels[aKey].localeCompare(labels[bKey]))
    .map(([key,value])=>({
      key,label:labels[key],valueCad:value.fixed(2),
      percentOfPortfolio:percentage(value,total),
      percentOfInvested:key==='cash'?null:percentage(value,invested)
    }));
  return entries.filter(e=>e.percentOfPortfolio!==null);
};
const classifiedWeights=(analysis,field,labels,asOf)=>{
  if(!analysis||analysis[field]===undefined) return [{key:'unclassified',share:HUNDRED}];
  if(analysis.asOf!==asOf)throw Error('Synthetic exposure metadata is not dated to the valuation snapshot');
  const input=analysis[field];
  if(!Array.isArray(input)||input.length===0)throw Error('Exposure dimension must have nonempty weights');
  const seen=new Set(),mapped=input.map(({key,weight})=>{
    if(key==='cash'||key==='unclassified'||!Object.hasOwn(labels,key)||seen.has(key)){
      throw Error('Invalid or duplicate exposure category');
    }
    seen.add(key);
    const w=Q.of(weight);
    if(w.cmp(Z)<=0||w.cmp(HUNDRED)>0)throw Error('Exposure weights must be positive percentages');
    return {key,share:w};
  });
  if(sum(mapped.map(v=>v.share)).cmp(HUNDRED)!==0)throw Error('Exposure weights must sum to exactly 100%');
  return mapped;
};
const validateMap=(map,total)=>{
  if(sum([...map.values()]).cmp(total)!==0)throw Error('Synthetic exposure breakdown does not reconcile');
};

// Sector policy is only a user-authored investment target in a future secure
// version. This fixture uses an invented example to demonstrate relative drift.
function compareIllustrativeSectorPolicy(policy,sectors,invested,classified,asOf){
  if(policy==null)return null;
  if(policy.synthetic!==true||policy.asOf!==asOf||!Array.isArray(policy.targets))
    throw Error('Invalid or stale fictional sector policy');
  if(invested.cmp(Z)===0||classified.cmp(invested)!==0)return null;
  const seen=new Set(),targets=new Map();
  for(const row of policy.targets){
    if(!row||row.key==='cash'||row.key==='unclassified'||!Object.hasOwn(sectorNames,row.key)||
      seen.has(row.key))throw Error('Unknown or duplicate demo target sector');
    seen.add(row.key);
    const weight=Q.of(row.weight);
    if(weight.cmp(Z)<0||weight.cmp(HUNDRED)>0)throw Error('Invalid demo target allocation');
    targets.set(row.key,weight);
  }
  if(sum([...targets.values()]).cmp(HUNDRED)!==0)
    throw Error('Demo sector targets must sum to exactly 100%');
  const all=new Set([...sectors.keys(),...targets.keys()]);
  all.delete('cash');
  all.delete('unclassified');
  const comparisons=[...all].map(key=>{
    const value=sectors.get(key)??Z,actual=value.div(invested).mul(HUNDRED);
    const target=targets.get(key)??Z,delta=actual.sub(target);
    return {key,label:sectorNames[key],actualPct:Number(actual.fixed(1)),
      targetPct:Number(target.fixed(1)),deltaPp:Number(delta.fixed(1)),
      valueCad:value.fixed(2)};
  }).sort((a,b)=>Math.abs(b.deltaPp)-Math.abs(a.deltaPp)||a.label.localeCompare(b.label));
  return {
    synthetic:true,asOf,policyName:String(policy.name??'Fictional targets'),
    source:'Invented targets, not a recommendation or benchmark',
    basis:'Percentage of INVESTED holdings, excluding cash',
    rows:comparisons,
    limitations:'Above/below compares ONLY to this illustrative target. A small weight does not imply a sector should be bought.'
  };
}

export function calculateSyntheticExposure({holdings,cashCad,totalCad,asOf,exampleSectorPolicy=null}){
  if(!Array.isArray(holdings)||!asOf)throw Error('Missing synthetic exposure data');
  const cash=allowExact(cashCad,'Cash'),total=allowExact(totalCad,'Total');
  if(total.cmp(Z)===0)return null;
  const vehicle=new Map(),strategy=new Map(),sectors=new Map(),regions=new Map(),etfMix=new Map();
  const invested=sum(holdings.map(h=>allowExact(h.marketCad,'Holding value')));
  if(cash.add(invested).cmp(total)!==0)throw Error('Cash/positions do not reconcile to total');
  for(const map of [vehicle,strategy,sectors,regions])add(map,'cash',cash);
  let sectorClassified=Z,regionClassified=Z;
  for(const h of holdings){
    if(!Object.hasOwn(vehicleNames,h.kind)||h.kind==='cash')
      throw Error('Unsupported synthetic investment vehicle');
    add(vehicle,h.kind,h.marketCad);
    const a=h.analysis??null;
    if(a&&(!Object.hasOwn(strategyNames,a.strategy)||a.strategy==='cash'||a.strategy==='unclassified')){
      throw Error('Unsupported synthetic investment strategy classification');
    }
    if(a&&a.asOf!==asOf)throw Error('Synthetic strategy classification date mismatch');
    const strategyKey=a?.strategy??'unclassified';
    add(strategy,strategyKey,h.marketCad);
    if(h.kind==='etf')add(etfMix,strategyKey,h.marketCad);
    for(const [field,map,labels] of [
      ['sectors',sectors,sectorNames],
      ['geographies',regions,geographyNames]
    ]){
      const weights=classifiedWeights(a,field,labels,asOf);
      if(weights.every(w=>w.key!=='unclassified')){
        if(field==='sectors')sectorClassified=sectorClassified.add(h.marketCad);
        else regionClassified=regionClassified.add(h.marketCad);
      }
      for(const w of weights){
        add(map,w.key,h.marketCad.mul(w.share).div(HUNDRED));
      }
    }
  }
  for(const map of [vehicle,strategy,sectors,regions])validateMap(map,total);
  const etfTotal=sum([...etfMix.values()]);
  const etfs=[...etfMix].map(([key,amount])=>({
    key,label:strategyNames[key],
    valueCad:amount.fixed(2),
    percentOfEtfs:percentage(amount,etfTotal),
    percentOfPortfolio:percentage(amount,total)
  })).sort((a,b)=>Number(b.valueCad)-Number(a.valueCad));
  const dimensions={
    vehicle:rows(vehicle,vehicleNames,total,invested),
    strategy:rows(strategy,strategyNames,total,invested),
    sector:rows(sectors,sectorNames,total,invested),
    geography:rows(regions,geographyNames,total,invested)
  };
  const largest=(dimension)=>dimensions[dimension]
    .find(r=>r.key!=='cash'&&r.key!=='unclassified')??null;
  return {
    synthetic:true,asOf,basis:'Total CAD-equivalent market value including cash',
    source:'Invented, manually specified classification; not verified ETF constituents',
    dimensions,etfMix:etfs,
    exampleSectorComparison:compareIllustrativeSectorPolicy(
      exampleSectorPolicy,sectors,invested,sectorClassified,asOf
    ),
    investedValueCad:invested.fixed(2),
    cashValueCad:cash.fixed(2),
    etfValueCad:etfTotal.fixed(2),
    coverage:{
      sectorPctOfInvested:percentage(sectorClassified,invested),
      geographyPctOfInvested:percentage(regionClassified,invested)
    },
    diagnostics:{
      cashPctOfPortfolio:percentage(cash,total),
      largestSector:largest('sector'),largestGeography:largest('geography')
    },
    limitations:'Sector and country categories are independent weighted views; ETF look-through is illustrative, not actual constituent holdings, issuer overlap, diversification assurance or a buy/sell signal.'
  };
}
