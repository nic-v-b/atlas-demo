import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getScenario } from "./fixtures.mjs";
import { publicSummary } from "./takeaway.mjs";
import {getHoldingsFixture} from "./holdings-fixture.mjs";
import {calculateSyntheticHoldings} from "./holdings.mjs";
import {buildSyntheticTaxLabView} from "./tax-lab-view.mjs";
import {buildUnifiedSyntheticViews} from "./r1a-unified.mjs";
import {getUnifiedSyntheticJournal,R1A_JOURNAL_ID} from "./r1a-journal.mjs";
import {JOURNAL_SCHEMA_VERSION} from "../web/journal-response.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../web");
const routes = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/tax-lab", ["acb-lab.html", "text/html; charset=utf-8"]],
  ["/holdings", ["holdings.html", "text/html; charset=utf-8"]],
  ["/holdings.css", ["holdings.css", "text/css; charset=utf-8"]],
  ["/holdings.js", ["holdings.js", "text/javascript; charset=utf-8"]],
  ["/theme.js", ["theme.js", "text/javascript; charset=utf-8"]],
  ["/journal-response.mjs", ["journal-response.mjs", "text/javascript; charset=utf-8"]],
  ["/accounting/rational.mjs", ["../accounting/rational.mjs", "text/javascript; charset=utf-8"]],
  ["/tax-lab.js", ["tax-lab.js", "text/javascript; charset=utf-8"]],
  ["/acb-lab.css", ["acb-lab.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);

const importRoutes=new Map([
  ['/import',['import.html','text/html; charset=utf-8']],
  ['/import.js',['import.js','text/javascript; charset=utf-8']],
  ['/import.css',['import.css','text/css; charset=utf-8']],
  ['/synthetic-csv.mjs',['synthetic-csv.mjs','text/javascript; charset=utf-8']],
  ['/synthetic-snapshot.csv',['../fixtures/SYN-HOLDINGS.csv.txt','text/csv; charset=utf-8']]
]);

// Used only by the opt-in HTML responses; default demo files stay untouched.
function syntheticNavigation(html,path){
  const destinations=[['/','Overview'],['/holdings','Holdings'],
    ['/tax-lab','Tax Lab'],['/import','Fictional CSV']];
  const links=destinations.map(([href,label])=>
    `      <a href="${href}"${href===path?' aria-current="page"':''}>${label}</a>`).join('\n');
  return html.replace(/(<nav class="workspace-nav"[^>]*>)[\s\S]*?<\/nav>/,
    `$1\n${links}\n    </nav>`);
}

export function createAppServer({syntheticCsv=false}={}) {
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
    if (req.method !== "GET") { res.writeHead(405); res.end("Method not allowed"); return; }
    const url = new URL(req.url, "http://127.0.0.1");
    if(importRoutes.has(url.pathname)){
      if(!syntheticCsv){res.writeHead(404);res.end('Not found');return;}
      // Static assets only. CSV contents never cross this HTTP boundary.
      const host=req.headers.host;
      const expected='127.0.0.1:'+req.socket.localPort;
      if(host!==expected||req.rawHeaders.filter((h,i)=>i%2===0&&h.toLowerCase()==='host').length!==1||
        (req.headers.origin!==undefined&&req.headers.origin!=='http://'+expected)){
        res.writeHead(403);res.end('Invalid local request');return;
      }
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'");
      const [file,type]=importRoutes.get(url.pathname);
      try{const bytes=await readFile(resolve(root,file));res.writeHead(200,{'Content-Type':type});res.end(type.startsWith('text/html')?syntheticNavigation(bytes.toString('utf8'),url.pathname):bytes);}
      catch{res.writeHead(500);res.end('Synthetic import asset unavailable');}
      return;
    }
    if (url.pathname === "/api/summary") {
      const fixture = getScenario(url.searchParams.get("scenario") || "stable");
      if (!fixture) { res.writeHead(404); res.end("Unknown synthetic scenario"); return; }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(publicSummary(fixture)));
      return;
    }
    // These two endpoints calculate synthetic fixture-only data in memory.
    // They accept neither amounts nor transaction JSON from clients.
    if (url.pathname === "/api/holdings") {
      try {
        const raw = url.searchParams.get("accounts");
        if (url.searchParams.size > (raw===null?0:1) || (raw!==null && raw.length>250)) {
          res.writeHead(400); res.end("Invalid synthetic selection"); return;
        }
        const selected = raw===null ? null : raw.split(",");
        const view=calculateSyntheticHoldings(getHoldingsFixture(),{accountIds:selected});
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
        res.end(JSON.stringify(view));
      } catch {
        res.writeHead(400); res.end("Invalid synthetic account selection or fixture");
      }
      return;
    }
    // A single fictional event journal projects the same accounting state into
    // Overview, Holdings and Tax Lab; no POST, upload or client journal accepted.
    if (url.pathname === "/api/r1a/state") {
      const reject=(status,code,requestedAccountIds=null)=>{
        res.writeHead(status,{"Content-Type":"application/json; charset=utf-8"});
        res.end(JSON.stringify({schemaVersion:JOURNAL_SCHEMA_VERSION,synthetic:true,
          journalId:R1A_JOURNAL_ID,code,requestedAccountIds}));
      };
      const raw=url.searchParams.get("accounts");
      if(url.searchParams.size>(raw===null?0:1)||(raw!==null&&raw.length>250)){
        reject(400,'INVALID_REQUEST');return;
      }
      try {
        const journal=getUnifiedSyntheticJournal(),accountIds=raw===null?null:raw.split(',');
        if(accountIds!==null&&(accountIds.length===0||new Set(accountIds).size!==accountIds.length||
           accountIds.some(id=>!journal.accounts.some(a=>a.id===id)))){
          reject(400,'INVALID_ACCOUNT_SELECTION',accountIds);return;
        }
        const view=buildUnifiedSyntheticViews(journal,{accountIds});
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
        res.end(JSON.stringify(view));
      }catch{
        reject(500,'JOURNAL_UNAVAILABLE');
      }
      return;
    }
    if (url.pathname === "/api/tax-lab") {
      if (url.searchParams.size) {res.writeHead(400);res.end("Unsupported query");return;}
      try{
        const view=buildSyntheticTaxLabView();
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
        res.end(JSON.stringify(view));
      }catch{
        res.writeHead(500); res.end("Synthetic Tax Lab evaluation unavailable");
      }
      return;
    }
    const item = routes.get(url.pathname);
    if (!item) { res.writeHead(404); res.end("Not found"); return; }
    try {
      const bytes = await readFile(resolve(root, item[0]));
      res.writeHead(200, { "Content-Type": item[1] });
      // Default demo responses remain byte-for-byte unchanged.
      const body = syntheticCsv && item[1].startsWith('text/html')
        ? syntheticNavigation(bytes.toString('utf8'),url.pathname)
        : bytes;
      res.end(body);
    } catch {
      res.writeHead(500); res.end("Demo file unavailable");
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer({syntheticCsv:process.argv.includes('--synthetic-csv')});
  server.listen(4711, "127.0.0.1", () => {
    process.stdout.write("Synthetic prototype on http://127.0.0.1:4711 (loopback only)\n");
  });
}
