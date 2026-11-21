import {readFile} from 'node:fs/promises';
import {Script,createContext} from 'node:vm';
import {parseSyntheticSnapshot,snapshotView,ACCOUNTS,MAX_CSV_BYTES,CsvError} from '../web/synthetic-csv.mjs';

class Node {
  constructor(){this.children=[];this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.files=[];this.value='';this.listeners={};this.attributes={};}
  append(child){this.children.push(child);}
  replaceChildren(){this.children=[];this.textContent='';}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  async fire(name){await this.listeners[name]?.();}
}
export async function csvHarness(){
  const html=await readFile(new URL('../web/import.html',import.meta.url),'utf8');
  const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Node()]));
  const document={getElementById:id=>{if(!nodes.has(id))throw Error('Unknown test DOM id');return nodes.get(id);},createElement:()=>new Node()};
  const events={};let outbound=0,persisted=0;
  const denyNetwork=()=>{outbound++;throw Error('Unexpected network');};
  const storage={setItem(){persisted++;throw Error('Unexpected persistence');}};
  const context=createContext({document,window:{addEventListener:(k,v)=>{events[k]=v;},localStorage:storage,sessionStorage:storage},
    localStorage:storage,sessionStorage:storage,indexedDB:{open(){persisted++;throw Error('Unexpected persistence');}},
    fetch:denyNetwork,XMLHttpRequest:denyNetwork,WebSocket:denyNetwork,navigator:{sendBeacon:denyNetwork},
    parseSyntheticSnapshot,snapshotView,ACCOUNTS,MAX_CSV_BYTES,CsvError,initializeAtlasTheme(){}});
  const source=await readFile(new URL('../web/import.js',import.meta.url),'utf8');
  new Script(source.replace(/^import .*;\r?\n/gm,'')).runInContext(context);
  return {node:id=>nodes.get(id),events,counts:()=>({outbound,persisted}),
    async select(content,size=Buffer.byteLength(content)){
      nodes.get('csv-file').files=[{size,text:async()=>content}];
      nodes.get('fictional').checked=true;await nodes.get('csv-file').fire('change');
    }};
}
