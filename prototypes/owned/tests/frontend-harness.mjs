import {readFile} from 'node:fs/promises';
import {Script,createContext} from 'node:vm';
import {readJournalResponse,InvalidAccountSelection,readSavedAccountSelection} from '../web/journal-response.mjs';

// Minimal DOM for executing our actual frontend scripts, without dependencies.
// This checks text, account controls and request ordering; it is not a layout engine.
class Element {
  constructor(tag='div'){
    this.tagName=tag;this.children=[];this.attributes={};this.dataset={};
    this.style={};this.hidden=false;this.className='';this.ownText='';
    this.listeners=new Map();
    this.classList={add:name=>{this.className+=' '+name;}};
  }
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(x=>x.textContent).join('');}
  get childElementCount(){return this.children.length;}
  setAttribute(key,value){
    this.attributes[key]=String(value);
    if(key==='class')this.className=String(value);
    if(key.startsWith('data-')){
      const camel=key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
      this.dataset[camel]=String(value);
    }
  }
  getAttribute(key){return this.attributes[key]??null;}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  replaceChildren(...nodes){this.ownText='';this.children=[...nodes];}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  click(){this.listeners.get('click')?.();}
  focus(){this.listeners.get('focus')?.();}
  querySelectorAll(selector){
    return this.children.flatMap(child=>{
      const match=selector==='button'?child.tagName==='button':
        selector==='button[data-account]'?child.tagName==='button'&&child.dataset.account!==undefined:
        selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):false;
      return [...(match?[child]:[]),...child.querySelectorAll(selector)];
    });
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
export const settle=()=>new Promise(resolve=>setImmediate(resolve));
export async function frontendHarness(script,page,{storage=null,storageAccess=null}={}){
  const [source,html]=await Promise.all([
    readFile(new URL('../web/'+script,import.meta.url),'utf8'),
    readFile(new URL('../web/'+page,import.meta.url),'utf8')
  ]);
  const nodes=new Map();
  for(const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const node=new Element(match[1]);
    for(const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g))node.setAttribute(attr[1],attr[2]);
    node.hidden=/\bhidden\b/.test(match[2]);
    node.textContent=html.slice(match.index+match[0].length).split('</'+match[1]+'>')[0].replace(/<[^>]*>/g,'');
    nodes.set(match[3],node);
  }
  const requests=[];
  const document={
    getElementById(id){if(!nodes.has(id))throw Error('Unknown DOM id: '+id);return nodes.get(id);},
    createElement:tag=>new Element(tag),
    querySelectorAll:selector=>selector==='[data-exposure]'?[...nodes.values()].filter(n=>n.dataset.exposure):
      selector==='[data-value-mode]'?[...nodes.values()].filter(n=>n.dataset.valueMode):[]
  };
  // Shared Map is strictly a fabricated account-filter session, not finance storage.
  const memory=storage??new Map();
  const sessionStorage={
    getItem:key=>memory.has(key)?memory.get(key):null,
    setItem:(key,value)=>memory.set(key,String(value)),
    removeItem:key=>memory.delete(key)
  };
  const globals={document,readJournalResponse,InvalidAccountSelection,readSavedAccountSelection,initializeAtlasTheme(){},fetch(url,options){
    return new Promise((resolve,reject)=>requests.push({url,options,reject,
      // Real HTTP JSON does not retain shared object references from projections.
      resolve(data){resolve({ok:true,json:async()=>JSON.parse(JSON.stringify(data))});},
      httpFailure(status=503,data=null){resolve({ok:false,status,json:async()=>structuredClone(data)});},
      httpHeaders(status,json){resolve({ok:false,status,json});},
      headers(json){resolve({ok:true,json});}
    }));
  }};
  Object.defineProperty(globals,'sessionStorage',{get:()=>storageAccess?storageAccess(sessionStorage):sessionStorage});
  const context=createContext(globals);
  // Theme is covered by the existing theme tests; evaluate all portfolio code unchanged.
  new Script(source.replace(/^import .* from '\.\/(?:theme\.js|journal-response\.mjs)';\r?\n/gm,''),{filename:script}).runInContext(context);
  return {html,requests,sessionStorage,node:id=>document.getElementById(id),
    buttons:()=>document.getElementById('account-filters').querySelectorAll('button[data-account]')};
}
