import test from 'node:test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createAppServer} from '../backend/server.mjs';

// Loopback HTTP smoke tests against fictional, read-only Tax Lab content.
// No production accounts, remote URLs, or external requests.
test('local synthetic Tax Lab route returns educational HTML with security headers',async()=>{
  const server=createAppServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url='http://127.0.0.1:'+server.address().port;
  try{
    const r=await fetch(url+'/tax-lab',{cache:'no-store'});
    assert.equal(r.status,200);
    assert.match(r.headers.get('content-type')??'',/text\/html/);
    assert.equal(r.headers.get('cache-control'),'no-store');
    assert.match(r.headers.get('content-security-policy')??'',/connect-src 'self'/);
    const body=await r.text();
    assert.match(body,/SYNTHETIC MODE/);
    assert.match(body,/Why do two taxable accounts share one cost per share/);
    // R0g replaces hardcoded page amounts with a deterministic R0f API.
    assert.match(body,/id="acb-before-cost"/);
    const api=await fetch(url+'/api/tax-lab');
    assert.equal(api.status,200);
    assert.equal((await api.json()).before.cost,'CA$600.00');
    assert.match(body,/superficial loss/i);
    assert.match(body,/No real monetary values are accepted or stored/);
    assert.doesNotMatch(body,/api\.rbc|login\.rbc|accountNumber|localStorage|script src="https/);
    const style=await fetch(url+'/acb-lab.css');
    assert.equal(style.status,200);
    assert.match(await style.text(),/acb-hero/);
    const home=await fetch(url+'/');
    assert.match(await home.text(),/href="\/tax-lab"/);
  }finally{
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});
test('synthetic server refuses writes, arbitrary private files and unknown routes',async()=>{
  const server=createAppServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url='http://127.0.0.1:'+server.address().port;
  try{
    const a=await fetch(url+'/tax-lab',{method:'POST'});
    assert.equal(a.status,405);
    const b=await fetch(url+'/not-a-route');
    assert.equal(b.status,404);
    const c=await fetch(url+'/../secrets');
    assert.equal(c.status,404);
  }finally{
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});


test('Overview and Tax Lab share a wrapping workspace navigation',async()=>{
  const server=createAppServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url='http://127.0.0.1:'+server.address().port;
  try{
    for(const [path,active] of [['/','/'],['/tax-lab','/tax-lab']]){
      const html=await (await fetch(url+path)).text();
      const match=html.match(/<nav class="workspace-nav" aria-label="Workspace navigation">([\s\S]*?)<\/nav>/);
      assert.ok(match,'missing workspace navigation on '+path);
      assert.match(match[1],/<a href="\/"/);
      assert.match(match[1],/<a href="\/tax-lab"/);
      assert.match(match[1],new RegExp('href="'+active.replaceAll('/','\\/')+'" aria-current="page"'));
    }
    const css=await (await fetch(url+'/styles.css')).text();
    assert.match(css,/\.workspace-nav\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/);
    assert.match(css,/:focus-visible\s*\{[^}]*outline:/);
    assert.match(css,/min-height:\s*44px/);
  }finally{
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});


test('notebook navigation text and selected-state colours contrast in both themes',async()=>{
  const css=await readFile(new URL('../web/styles.css',import.meta.url),'utf8');
  const themes=[
    css.match(/:root\s*\{([^}]+)\}/)?.[1],
    css.match(/body:not\(\.light\)\s*\{([^}]+)\}/)?.[1]
  ];
  assert.match(css,/\.workspace-nav a\s*\{[^}]*color:\s*var\(--muted\)/);
  assert.match(css,/\.workspace-nav a\[aria-current="page"\]\s*\{[^}]*color:\s*var\(--text\)/);
  const luminance=hex=>{
    const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
      .map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
    return 0.2126*r+0.7152*g+0.0722*b;
  };
  for(const theme of themes){
    const token=name=>{
      const match=theme?.match(new RegExp('--'+name+':\\s*(#[0-9a-fA-F]{6})'));
      assert.ok(match,'missing notebook token: '+name);
      return match[1];
    };
    for(const [foreground,background,min] of [
      ['muted','paper',4.5],['text','paper',4.5],['accent','paper',3],
      ['accent','wash',4.5],['on-accent','accent',4.5]
    ]){
      const [hi,lo]=[luminance(token(foreground)),luminance(token(background))].sort((a,b)=>b-a);
      assert.ok((hi+0.05)/(lo+0.05)>=min,foreground+' on '+background);
    }
  }
});
