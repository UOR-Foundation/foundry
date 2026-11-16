// The shipped parser/check permission UI and transport, with all remote traffic intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '../vendor/dyad/node_modules/playwright-core/index.mjs';
const root=fileURLToPath(new URL('../shell/',import.meta.url));
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Hosted permission browser acceptance</title><button id="prior">Before request</button>');return;}
 const file=path.resolve(root,'.'+decodeURIComponent(pathname));
 if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',file.endsWith('.json')?'application/json':'text/javascript');res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const executablePath=process.env.CHROME_BIN||['/usr/bin/chromium','/usr/bin/google-chrome'].find(file=>fs.existsSync(file));
let browser;
try{
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});const context=await browser.newContext(),page=await context.newPage(),sent=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));let hold=false,release,redirect=false,redirected=0;
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.href==='https://mcp.uor.foundation/'){
   const request=JSON.parse(route.request().postData());sent.push({request,headers:route.request().headers()});
   if(redirect){await route.fulfill({status:302,headers:{location:'https://unapproved.invalid/leak'}});return;}
   if(hold){await new Promise(resolve=>release=resolve);try{await route.abort();}catch{}return;}
   const data=request.params.name==='lexlean_draft_write'?{draft:'prism-app/browser'}:{data:{spec:'lexlean/semantic-module/2',declarations:[]}};
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({result:{structuredContent:data}})});return;
  }
  if(url.origin==='https://unapproved.invalid')redirected++;
  if(url.origin===base)return route.continue();return route.abort();
 });
 await page.goto(base);await page.evaluate(async()=>{const permission=window.permission=await import('/hosted-source-permission.mjs');
  // A parse through the boundary: the shell's preview reads its data form in the tab, so only this suite sends one.
  const call=(f,name,args)=>f(permission.HOSTED_SOURCE_ENDPOINT,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}).then(r=>r.json()).then(r=>r.result.structuredContent);
  window.api={createHostedSourceSession:permission.createHostedSourceSession,dataForm:(source,fetchImpl,opts)=>{const files=[{path:'src/App.lex.tex',content:source}];return permission.withHostedSourcePermission({purpose:'parse',files},async f=>{const {draft}=await call(f,'lexlean_draft_write',{profile:'prism-app',files});return (await call(f,'lexlean_draft_read',{draft,path:'src/App.lex.tex',view:'data'})).data;},opts,fetchImpl);}};});
 const start=async({turn=false}={})=>page.evaluate(turn=>{
  window.result=null;window.controller=new AbortController();document.getElementById('prior').focus();
  if(turn)window.scope=window.api.createHostedSourceSession({appId:7,turnId:'browser-turn',source:'blake3:'+'a'.repeat(64),signal:controller.signal,assertCurrent:async()=>true});
  window.source='<script>window.injected=true</script> private app source';
  void window.api.dataForm(window.source,fetch,{signal:controller.signal,...(turn?{session:scope}:{})}).then(value=>result={ok:true},error=>result={code:error.code});
 },turn);
 const result=async()=>{await page.waitForFunction(()=>window.result!==null);return page.evaluate(()=>window.result);};
 const dialog=page.getByRole('dialog',{name:'Review hosted source transfer'});
 for(const action of ['escape','deny','abort']){
  await start();await dialog.waitFor();assert.equal(sent.length,0);assert.equal(await page.evaluate(()=>document.activeElement.textContent),"Don't send");
  if(action==='escape')await page.keyboard.press('Escape');if(action==='deny')await page.getByRole('button',{name:"Don't send",exact:true}).click();if(action==='abort')await page.evaluate(()=>controller.abort());
  assert.equal((await result()).code,action==='abort'?'hostedSourcePermissionCancelled':'hostedSourcePermissionDenied');assert.equal(await dialog.count(),0);
 }
 await start();await dialog.waitFor();assert.ok((await dialog.textContent()).includes('https://mcp.uor.foundation/'));assert.ok((await dialog.locator('pre').textContent()).includes('private app source'));assert.equal(await page.evaluate(()=>window.injected||false),false);
 await page.getByRole('button',{name:'Send this source',exact:true}).click();assert.equal((await result()).ok,true);assert.equal(sent.length,2);
 assert.equal(sent[0].request.params.arguments.files[0].content,await page.evaluate(()=>source));assert.equal(sent[0].headers.cookie,undefined);assert.equal(sent[0].headers.authorization,undefined);assert.equal(await page.getByRole('complementary',{name:'Active hosted source transfer'}).count(),0);
 await start({turn:true});await dialog.waitFor();assert.ok((await dialog.textContent()).includes('any fix in the same build'));await page.getByRole('button',{name:'Allow this turn',exact:true}).click();assert.equal((await result()).ok,true);
 await page.evaluate(async()=>{await api.dataForm('later generated prefix',fetch,{session:scope});scope.close();});assert.equal(sent.length,6);assert.equal(await dialog.count(),0);
 hold=true;await start();await dialog.waitFor();await page.getByRole('button',{name:'Send this source',exact:true}).click();for(let i=0;!release&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(release);await page.getByRole('button',{name:'Stop hosted source transfer',exact:true}).click();assert.equal((await result()).code,'hostedSourcePermissionCancelled');release();hold=false;
 redirect=true;await start();await dialog.waitFor();await page.getByRole('button',{name:'Send this source',exact:true}).click();assert.equal((await result()).code,'hostedSourceNetworkFailed');assert.equal(redirected,0);redirect=false;
 await context.setOffline(true);await start();assert.equal((await result()).code,'hostedSourcePermissionOffline');await context.setOffline(false);
 assert.deepEqual(errors,[]);console.log('Hosted source browser acceptance passed: denial, Escape, cancellation, text-only disclosure, exact bytes, turn prefixes, stop, redirects, cookies and offline.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
