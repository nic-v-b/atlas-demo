import {Q} from '../accounting/rational.mjs';

// A bounded fictional snapshot, never a transaction journal or broker importer.
export const MAX_CSV_BYTES=65536;
export const COLUMNS=Object.freeze(['format','asOf','accountId','accountType','securityId','kind','exchange','currency','quantity','unitPrice','marketValue','accountTotal','usdToCad']);
export const ACCOUNTS=Object.freeze({
  'SYN-CSV-TAX':Object.freeze({label:'Fictional taxable',type:'taxable'}),
  'SYN-CSV-TFSA':Object.freeze({label:'Fictional TFSA',type:'tfsa'}),
  'SYN-CSV-USD':Object.freeze({label:'Fictional USD taxable',type:'taxable'})
});
const securities={
  'SYN-MAPLE':['equity','SYN-TSX','CAD','Fictional Maple equity'],
  'SYN-GLOBAL':['etf','SYN-TSX','CAD','Fictional Global ETF'],
  'SYN-FUND-A':['fund','SYN-FUND','CAD','Fictional fund · series A'],
  'SYN-CDR':['cdr','SYN-TSX','CAD','Fictional CAD CDR · separate wrapper'],
  'SYN-US-EQUITY':['equity','SYN-NASDAQ','USD','Fictional US equity'],
  'SYN-CASH-CAD':['cash','SYN-CASH','CAD','Canadian-dollar cash'],
  'SYN-CASH-USD':['cash','SYN-CASH','USD','US-dollar cash']
};
const Z=Q.zero(),H=Q.of('100');
export class CsvError extends Error {
  constructor(code,row=null){super(code);this.name='CsvError';this.code=code;this.row=row;}
}
function check(ok,code,row){if(!ok)throw new CsvError(code,row);}

function csvRows(text){
  check(typeof text==='string'&&new TextEncoder().encode(text).length<=MAX_CSV_BYTES,'FILE_SIZE');
  text=text.replace(/^\uFEFF/,'');
  check(text.length>0,'EMPTY_SNAPSHOT');
  check(!/[^\x20-\x7e\r\n]/.test(text),'CSV_CHARACTERS');
  const rows=[];let row=[],cell='',state='start';
  const endCell=()=>{row.push(cell);cell='';check(row.length<=COLUMNS.length,'COLUMN_COUNT',rows.length+1);};
  const endRow=()=>{endCell();rows.push(row);row=[];state='start';check(rows.length<=101,'ROW_LIMIT');};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(state==='quoted'){
      if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else state='closed';}
      else {check(c!=='\r'&&c!=='\n','MULTILINE_FIELD',rows.length+1);cell+=c;}
    }else if(c===',' ){endCell();state='start';}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'){check(text[i+1]==='\n','CSV_NEWLINE',rows.length+1);i++;}
      endRow();
    }else if(c==='"'){check(state==='start','CSV_QUOTES',rows.length+1);state='quoted';}
    else {check(state!=='closed','CSV_QUOTES',rows.length+1);cell+=c;state='plain';}
    check(cell.length<=80,'FIELD_SIZE',rows.length+1);
  }
  check(state!=='quoted','CSV_QUOTES',rows.length+1);
  if(cell!==''||row.length||state==='closed')endRow();
  check(rows.length>=2,'EMPTY_SNAPSHOT');
  check(JSON.stringify(rows.shift())===JSON.stringify(COLUMNS),'HEADER');
  return rows;
}
function number(value,places,row,{positive=false}={}){
  check(new RegExp('^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,'+places+'})?$').test(value),'DECIMAL',row);
  const q=Q.of(value);check(q.cmp(Z)>=(positive?1:0),'VALUE_RANGE',row);return q;
}
function date(value){
  check(/^20\d{2}-\d{2}-\d{2}$/.test(value),'DATE');
  const d=new Date(value+'T00:00:00Z');
  check(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value,'DATE');
}

export function parseSyntheticSnapshot(text){
  const records=csvRows(text),seen=new Set(),totals=new Map();
  let asOf=null,fx=null,fxInput=null;
  const rows=records.map((cells,i)=>{
    const line=i+2;
    check(cells.length===COLUMNS.length,'COLUMN_COUNT',line);
    const r=Object.fromEntries(COLUMNS.map((k,j)=>[k,cells[j]]));
    check(r.format==='ATLAS-SYN-SNAPSHOT-1','SYNTHETIC_FORMAT',line);
    date(r.asOf);asOf??=r.asOf;check(asOf===r.asOf,'MIXED_DATES',line);
    const account=ACCOUNTS[r.accountId],security=Object.hasOwn(securities,r.securityId)?securities[r.securityId]:null;
    check(Object.hasOwn(ACCOUNTS,r.accountId)&&account.type===r.accountType,'SYNTHETIC_ACCOUNT',line);
    check(security&&security[0]===r.kind&&security[1]===r.exchange&&security[2]===r.currency,'SYNTHETIC_SECURITY',line);
    const key=r.accountId+'|'+r.securityId;
    check(!seen.has(key),'DUPLICATE',line);seen.add(key);
    const quantity=number(r.quantity,12,line,{positive:r.kind!=='cash'});
    const price=number(r.unitPrice,12,line,{positive:true});
    check(r.kind!=='cash'||price.cmp(Q.of('1'))===0,'CASH_PRICE',line);
    const value=number(r.marketValue,2,line),declared=number(r.accountTotal,2,line);
    const product=quantity.mul(price);
    check(Q.of(product.fixed(2)).cmp(value)===0,'ROW_RECONCILIATION',line);
    const groupKey=r.accountId+'|'+r.currency;
    const group=totals.get(groupKey)??{accountId:r.accountId,currency:r.currency,declared,total:Z};
    check(group.declared.cmp(declared)===0,'INCONSISTENT_TOTAL',line);
    group.total=group.total.add(value);totals.set(groupKey,group);
    const rate=r.usdToCad===''?null:number(r.usdToCad,12,line,{positive:true});
    if(fxInput===null){fxInput=r.usdToCad;fx=rate;}
    check(r.usdToCad===fxInput,'INCONSISTENT_FX',line);
    return {accountId:r.accountId,accountType:r.accountType,securityId:r.securityId,
      name:security[3],kind:r.kind,exchange:r.exchange,currency:r.currency,
      quantity:r.quantity,unitPrice:r.unitPrice,marketValue:value.fixed(2),
      roundingDifference:value.sub(product).fixed(12)};
  });
  for(const group of totals.values())check(group.total.cmp(group.declared)===0,'ACCOUNT_RECONCILIATION');
  const snapshot={synthetic:true,format:'ATLAS-SYN-SNAPSHOT-1',asOf,
    usdToCad:fx===null?null:fxInput,rows,
    accounts:[...totals.values()].map(g=>({accountId:g.accountId,currency:g.currency,total:g.total.fixed(2)}))};
  return snapshot;
}

// Snapshot values use source cents reconciled above. Never invent buys/deposits
// to send a holdings snapshot through the transaction-ledger engine.
export function snapshotView(snapshot,accountIds=null){
  const available=[...new Set(snapshot.rows.map(r=>r.accountId))];
  const selected=accountIds??available;
  check(Array.isArray(selected)&&selected.length>0&&new Set(selected).size===selected.length&&
    selected.every(id=>available.includes(id)),'ACCOUNT_SELECTION');
  const rows=snapshot.rows.filter(r=>selected.includes(r.accountId));
  const totals={CAD:Z,USD:Z};
  for(const r of rows)totals[r.currency]=totals[r.currency].add(Q.of(r.marketValue));
  const fx=snapshot.usdToCad===null?null:Q.of(snapshot.usdToCad);
  const canConvert=totals.USD.cmp(Z)===0||fx!==null;
  const combined=canConvert?totals.CAD.add(fx?totals.USD.mul(fx):Z):null;
  const pct=(part,total)=>total.cmp(Z)===0?null:part.mul(H).div(total).fixed(2);
  const allocation=new Map();
  const positions=rows.map(r=>{
    const amount=Q.of(r.marketValue),cad=r.currency==='CAD'?amount:fx?amount.mul(fx):null;
    if(canConvert)allocation.set(r.kind,(allocation.get(r.kind)??Z).add(cad??Z));
    return {...r,cadEquivalent:cad?.fixed(2)??null,
      nativePercent:pct(amount,totals[r.currency]),portfolioPercent:combined?pct(cad??Z,combined):null};
  });
  return {asOf:snapshot.asOf,selected,positions,usdToCad:snapshot.usdToCad,
    currencyTotals:{CAD:totals.CAD.fixed(2),USD:totals.USD.fixed(2)},cadEquivalent:combined?.fixed(2)??null,
    accounts:snapshot.accounts.filter(a=>selected.includes(a.accountId)),
    allocation:[...allocation].map(([kind,value])=>({kind,cadEquivalent:value.fixed(2),percent:pct(value,combined)})),
    unavailable:['Complete ACB','Realized gains','Historical returns (TWR / MWR)','Dividend history'],
    reconciliation:'Every row matches quantity × price rounded to cents; source totals match each account/currency exactly.'};
}
