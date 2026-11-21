import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {request} from 'node:http';
import {parseSyntheticSnapshot,snapshotView,MAX_CSV_BYTES,CsvError} from '../web/synthetic-csv.mjs';
import {createAppServer} from '../backend/server.mjs';
import {csvHarness} from './csv-ui-harness.mjs';

const sample=await readFile(new URL('../fixtures/SYN-HOLDINGS.csv.txt',import.meta.url),'utf8');
const lines=sample.trimEnd().split(/\r?\n/);
function edit(row,column,value){const all=lines.map(l=>l.split(','));all[row][column]=value;return all.map(l=>l.join(',')).join('\n')+'\n';}
const bad=(text,code)=>assert.throws(()=>parseSyntheticSnapshot(text),e=>e instanceof CsvError&&e.code===code&&!e.message.includes('250.00'));
test('CSV sample reconciles three separate fictional accounts with exact dated FX',()=>{
  const s=parseSyntheticSnapshot(sample),v=snapshotView(s);
  assert.equal(s.rows.length,7);assert.equal(v.cadEquivalent,'1147.50');
  assert.deepEqual(v.currencyTotals,{CAD:'675.00',USD:'350.00'});
  assert.deepEqual(v.accounts.map(a=>a.total),['375.00','300.00','350.00']);
  assert.equal(v.positions.find(r=>r.securityId==='SYN-US-EQUITY').cadEquivalent,'405.00');
  assert.equal(v.positions.find(r=>r.securityId==='SYN-MAPLE').portfolioPercent,'21.79');
});
test('CSV filters preserve taxable TFSA and USD account boundaries',()=>{
  const s=parseSyntheticSnapshot(sample);
  assert.equal(snapshotView(s,['SYN-CSV-TAX']).cadEquivalent,'375.00');
  assert.equal(snapshotView(s,['SYN-CSV-TFSA']).cadEquivalent,'300.00');
  assert.equal(snapshotView(s,['SYN-CSV-USD']).cadEquivalent,'472.50');
  for(const ids of [[],['REAL'],['SYN-CSV-TAX','SYN-CSV-TAX']])assert.throws(()=>snapshotView(s,ids));
});
test('CSV snapshot explicitly withholds unsupported tax income and performance metrics',()=>{
  const v=snapshotView(parseSyntheticSnapshot(sample));
  assert.deepEqual(v.unavailable,['Complete ACB','Realized gains','Historical returns (TWR / MWR)','Dividend history']);
  assert.equal(v.positions.some(p=>'bookValue' in p||'realizedGain' in p),false);
});
test('CSV missing FX keeps native amounts and withholds combined percentages',()=>{
  const text=lines.map((l,i)=>i===0?l:l.slice(0,l.lastIndexOf(','))+',').join('\n');
  const s=parseSyntheticSnapshot(text),v=snapshotView(s);
  assert.equal(v.cadEquivalent,null);assert.deepEqual(v.currencyTotals,{CAD:'675.00',USD:'350.00'});
  assert.equal(v.positions.every(r=>r.portfolioPercent===null),true);
  assert.equal(v.positions.find(r=>r.currency==='USD').cadEquivalent,null);
  assert.equal(snapshotView(s,['SYN-CSV-TAX']).cadEquivalent,'375.00');
});
test('CSV exact fractions validate subcent products without binary floating point',()=>{
  const cells=lines[1].split(',');cells[8]='0.123456789012';cells[9]='0.1';cells[10]='0.01';cells[11]='0.01';
  const v=snapshotView(parseSyntheticSnapshot(lines[0]+'\n'+cells.join(',')));
  assert.equal(v.cadEquivalent,'0.01');assert.equal(v.positions[0].quantity,'0.123456789012');
  assert.equal(v.positions[0].roundingDifference,'-0.002345678901');
});
test('CSV rounds half cents away from zero consistently with the existing Q oracle',()=>{
  const c=lines[1].split(',');c[8]='1';c[9]='1.005';c[10]=c[11]='1.01';
  assert.equal(snapshotView(parseSyntheticSnapshot(lines[0]+'\n'+c.join(','))).cadEquivalent,'1.01');
});
test('CSV zero cash is valid and zero total has unavailable allocation instead of NaN',()=>{
  const c=lines[2].split(',');c[8]=c[10]=c[11]='0';
  const v=snapshotView(parseSyntheticSnapshot(lines[0]+'\n'+c.join(',')));
  assert.equal(v.cadEquivalent,'0.00');assert.equal(v.positions[0].portfolioPercent,null);
});
test('CSV shared securities in separate accounts remain separate positions',()=>{
  const extra=lines[1].split(',');extra[2]='SYN-CSV-TFSA';extra[3]='tfsa';extra[11]='250.00';
  const s=parseSyntheticSnapshot([lines[0],lines[1].replace('375.00','250.00'),extra.join(',')].join('\n'));
  assert.equal(s.rows.length,2);assert.equal(snapshotView(s).cadEquivalent,'500.00');
});
test('CSV accepts BOM CRLF and consistently quoted fields',()=>{
  const quoted=lines.map(l=>l.split(',').map(c=>'"'+c+'"').join(',')).join('\r\n')+'\r\n';
  assert.deepEqual(parseSyntheticSnapshot('\uFEFF'+quoted),parseSyntheticSnapshot(sample));
});
for(const [name,row,column,value,code] of [
  ['nonfictional format',1,0,'LIVE','SYNTHETIC_FORMAT'],['unknown account',1,2,'REAL-ACCOUNT','SYNTHETIC_ACCOUNT'],
  ['account type mismatch',1,3,'tfsa','SYNTHETIC_ACCOUNT'],['unknown instrument',1,4,'AAPL','SYNTHETIC_SECURITY'],
  ['CDR currency ambiguity',5,7,'USD','SYNTHETIC_SECURITY'],['exchange ambiguity',1,6,'NASDAQ','SYNTHETIC_SECURITY'],
  ['fund series ambiguity',4,4,'SYN-FUND-B','SYNTHETIC_SECURITY'],['currency mismatch',1,7,'EUR','SYNTHETIC_SECURITY'],
  ['missing quantity',1,8,'','DECIMAL'],['negative quantity',1,8,'-1','DECIMAL'],['zero position quantity',1,8,'0','VALUE_RANGE'],
  ['exponential number',1,8,'1e1','DECIMAL'],['NaN',1,8,'NaN','DECIMAL'],['infinite price',1,9,'Infinity','DECIMAL'],
  ['excess precision',1,8,'0.1234567890123','DECIMAL'],['huge magnitude',1,8,'1000000000000','DECIMAL'],
  ['grouped number',1,8,'1 000','DECIMAL'],['whitespace number',1,8,' 10','DECIMAL'],
  ['missing price',1,9,'','DECIMAL'],['zero price',1,9,'0','VALUE_RANGE'],['fractional cent source',1,10,'250.001','DECIMAL'],
  ['row discrepancy',1,10,'249.99','ROW_RECONCILIATION'],['inconsistent source total',2,11,'374.00','INCONSISTENT_TOTAL'],
  ['mixed dates',2,1,'2026-11-17','MIXED_DATES'],['invalid leap date',1,1,'2026-02-29','DATE'],
  ['missing date',1,1,'','DATE'],['missing FX on one row',2,12,'','INCONSISTENT_FX'],
  ['contradictory FX',2,12,'1.4','INCONSISTENT_FX'],['zero FX',1,12,'0','VALUE_RANGE'],
  ['cash price not one',2,9,'2','CASH_PRICE'],['CSV formula',1,8,'=10','DECIMAL'],
  ['HTML identifier',1,4,'<img src=x>','SYNTHETIC_SECURITY']
])test('CSV rejects '+name,()=>bad(edit(row,column,value),code));
test('CSV account reconciliation independently rejects matching rows but wrong totals',()=>bad(sample.replaceAll('375.00','376.00'),'ACCOUNT_RECONCILIATION'));
test('CSV duplicate positions cannot silently double count a row',()=>bad(sample+lines[1]+'\n','DUPLICATE'));
for(const [name,text,code] of [
  ['empty file','','EMPTY_SNAPSHOT'],['header only',lines[0],'EMPTY_SNAPSHOT'],
  ['wrong header',sample.replace('accountId','account'),'HEADER'],['extra column',sample.replace('usdToCad','usdToCad,extra'),'COLUMN_COUNT'],
  ['missing column',edit(1,12,'1.35').replace(',375.00,1.35',',375.00'),'COLUMN_COUNT'],
  ['unterminated quote',sample+'"','CSV_QUOTES'],['quote in bare cell',sample.replace('SYN-MAPLE','SYN-"MAPLE'),'CSV_QUOTES'],
  ['content after quote',sample.replace('SYN-MAPLE','"SYN-MAPLE"x'),'CSV_QUOTES'],
  ['multiline quoted cell',sample.replace('SYN-MAPLE','"SYN-\nMAPLE"'),'MULTILINE_FIELD'],
  ['bare CR',sample.replaceAll('\n','\r'),'CSV_NEWLINE'],['blank data line',sample+'\n','COLUMN_COUNT'],
  ['NUL',sample+'\0','CSV_CHARACTERS'],['oversize','x'.repeat(MAX_CSV_BYTES+1),'FILE_SIZE'],
  ['overlong cell',sample.replace('SYN-MAPLE','x'.repeat(81)),'FIELD_SIZE'],
  ['too many rows',lines[0]+'\n'+(lines[1]+'\n').repeat(101),'ROW_LIMIT']
])test('CSV rejects malformed '+name,()=>bad(text,code));

test('browser workflow previews before confirmation then filters and clears without network or persistence',async()=>{
  const h=await csvHarness();await h.select(sample);await h.node('preview').fire('click');
  assert.equal(h.node('portfolio').hidden,false);assert.match(h.node('snapshot-heading').textContent,/not yet confirmed/);
  assert.equal(h.node('confirm').disabled,false);await h.node('confirm').fire('click');
  assert.equal(h.node('import-total').textContent,'CA$1147.50');assert.equal(h.node('import-rows').children.length,7);
  await h.node('import-accounts').children[0].fire('click');assert.equal(h.node('import-total').textContent,'CA$772.50');
  await h.node('clear').fire('click');assert.equal(h.node('portfolio').hidden,true);assert.equal(h.node('import-rows').children.length,0);
  assert.equal(h.node('import-total').textContent,'');assert.deepEqual(h.counts(),{outbound:0,persisted:0});
});
test('browser rejects invalid imports with fixed errors and no prior figures',async()=>{
  const h=await csvHarness();await h.select(sample);await h.node('preview').fire('click');await h.node('confirm').fire('click');
  await h.select(sample.replace('SYN-MAPLE','SECRET-CANARY'));await h.node('preview').fire('click');
  assert.equal(h.node('portfolio').hidden,true);assert.equal(h.node('confirm').disabled,true);
  assert.match(h.node('import-error').textContent,/SYNTHETIC_SECURITY/);assert.doesNotMatch(h.node('import-error').textContent,/SECRET-CANARY/);
});
test('browser selection clear and navigation defeat late file reads',async()=>{
  const h=await csvHarness();let done;await h.select(sample);
  h.node('csv-file').files[0].text=()=>new Promise(resolve=>{done=resolve;});
  const pending=h.node('preview').fire('click');await h.node('clear').fire('click');done(sample);await pending;
  assert.equal(h.node('portfolio').hidden,true);assert.equal(h.node('confirm').disabled,true);
  await h.select(sample);await h.node('preview').fire('click');h.events.pagehide();
  assert.equal(h.node('portfolio').hidden,true);assert.equal(h.node('import-rows').children.length,0);
});
test('browser requires fictional acknowledgement and bounds file size before reading',async()=>{
  const h=await csvHarness();await h.select(sample,MAX_CSV_BYTES+1);
  h.node('csv-file').files[0].text=()=>{throw Error('Must not read');};await h.node('preview').fire('click');
  assert.match(h.node('import-error').textContent,/FILE_SIZE/);
  h.node('fictional').checked=false;await h.node('fictional').fire('change');assert.equal(h.node('preview').disabled,true);
});
async function serve(t,enabled){const server=createAppServer({syntheticCsv:enabled});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return 'http://127.0.0.1:'+server.address().port;}

const destinations=['/','/holdings','/tax-lab','/import'];
const labels=['Overview','Holdings','Tax Lab','Fictional CSV'];
test('opt-in workspace navigation reaches all four ordered destinations with one accessible current link',async t=>{
  const base=await serve(t,true);
  for(const path of destinations){
    const response=await fetch(base+path);
    assert.equal(response.status,200,path);
    const html=await response.text();
    const nav=html.match(/<nav class="workspace-nav"([^>]*)>([\s\S]*?)<\/nav>/);
    assert.match(nav[1],/aria-label="[^"]+"/);
    const links=[...nav[2].matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)];
    assert.deepEqual(links.map(m=>m[2]),labels,path);
    assert.deepEqual(links.map(m=>m[1].match(/href="([^"]*)"/)[1]),destinations,path);
    assert.deepEqual(links.filter(m=>/aria-current="page"/.test(m[1])).map(m=>m[2]),[labels[destinations.indexOf(path)]],path);
    assert.equal((nav[2].match(/<a\b/g)||[]).length,4,path);
    assert.equal((nav[2].match(/aria-current=/g)||[]).length,1,path);
    assert.doesNotMatch(nav[2],/Planned|Demo holdings/);
  }
});

test('regular demo navigation is unchanged and all CSV assets stay unavailable',async t=>{
  const base=await serve(t,false);
  for(const [path,file] of [['/','index.html'],['/holdings','holdings.html'],['/tax-lab','acb-lab.html']]){
    const response=await fetch(base+path);assert.equal(response.status,200);
    const html=await response.text();
    assert.equal(html,await readFile(new URL('../web/'+file,import.meta.url),'utf8'));
    assert.doesNotMatch(html,/href="\/import"/);
  }
  for(const path of ['/import','/import.js','/import.css','/synthetic-csv.mjs','/synthetic-snapshot.csv']){
    assert.equal((await fetch(base+path)).status,404);
  }
});
test('import is opt-in; default server remains fixture-only and rejects uploads',async t=>{
  const base=await serve(t,false);
  for(const path of ['/import','/import.js','/synthetic-csv.mjs','/synthetic-snapshot.csv'])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/api/import/preview',{method:'POST',body:'SYN-CANARY'})).status,405);
  assert.equal((await (await fetch(base+'/api/r1a/state')).json()).synthetic,true);
});
test('enabled importer serves only static allowlisted assets with no connection permission',async t=>{
  const base=await serve(t,true);
  for(const path of ['/import','/import.js','/import.css','/synthetic-csv.mjs','/synthetic-snapshot.csv']){
    const response=await fetch(base+path);assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/connect-src 'none'/);assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.equal(await (await fetch(base+'/synthetic-snapshot.csv')).text(),sample);
  assert.equal((await fetch(base+'/fixtures/SYN-HOLDINGS.csv.txt')).status,404);
  assert.equal((await fetch(base+'/api/import/state')).status,404);
  assert.equal((await fetch(base+'/import',{method:'POST',body:sample})).status,405);
  assert.equal((await fetch(base+'/import',{method:'OPTIONS',headers:{Origin:'https://example.invalid'}})).status,405);
});
test('import static boundary rejects unexpected Host and Origin without CORS grants',async t=>{
  const base=await serve(t,true);
  for(const headers of [{Host:'evil.invalid'},{Origin:'null'},{Origin:'https://example.invalid'}]){
    // Raw HTTP preserves a custom Host; browser-style fetch may replace it.
    const response=await new Promise((resolve,reject)=>{const req=request(base+'/import',{headers},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));});req.on('error',reject);req.end();});
    assert.equal(response.status,403);assert.equal(response.headers['access-control-allow-origin'],undefined);
  }
  assert.equal((await fetch(base+'/import',{headers:{Origin:base}})).status,200);
});
