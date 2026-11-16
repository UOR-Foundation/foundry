import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkApp, splitDeclarations, wholePrefix} from '../shell/live/app.mjs';
import {authorizeHostedSource, describeHostedSource, createHostedSourceSession, withHostedSourcePermission, hostedSourceFailure, HOSTED_SOURCE_ENDPOINT} from '../shell/hosted-source-permission.mjs';
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const module = read('../../v2/loop/answers/guests-3.verified.lex.tex');
const whole = JSON.parse(read('../../v2/loop/answers/guests-3.json'));
const files = [{path:'src/App.lex.tex',content:'<script>private module</script>'}];
const input = {scope:'source',purpose:'parse',files};
const code = value => error => error.code === value;
const approval = async input => ({disclosure:describeHostedSource(input),expires:Date.now()+10000,signal:new AbortController().signal,close(){}});
const options = {authorize:approval,online:()=>true};
function dom() {
 const nodes=[];
 class Element extends EventTarget {constructor(tag){super();this.tag=tag;this.style={};this.children=[];nodes.push(this);}append(...children){this.children.push(...children);}setAttribute(){}remove(){this.removed=true;}showModal(){this.open=true;}focus(){document.activeElement=this;}click(){this.dispatchEvent(new Event('click'));}}
 const document={createElement:tag=>new Element(tag),body:new Element('body'),activeElement:{focus(){}}};
 return {document,nodes,button:label=>nodes.find(n=>n.tag==='button'&&n.textContent===label)};
}
function service() {
 const requests=[],drafts=new Map();
 const fetch=async(url,init)=>{
  requests.push({url,init});const request=JSON.parse(init.body),args=request.params.arguments;let payload;
  if(request.params.name==='lexlean_draft_write'){const draft='prism-app/'+drafts.size;drafts.set(draft,args.files);payload={draft};}
  else if(request.params.name==='lexlean_check')payload={success:true,diagnostics:[]};
  else {const source=drafts.get(args.draft).find(f=>f.path===args.path).content,names=new Set(splitDeclarations(source).declarations.map(d=>d.name));payload={data:{spec:whole.spec,declarations:whole.declarations.filter(d=>names.has(d.name))}};}
  return {ok:true,json:async()=>({result:{structuredContent:payload}})};
 };
 return {fetch,requests};
}
// A parse through the boundary itself: the preview reads its data form in the tab, so only these tests send one.
const dataForm=(source,fetchImpl,opts={})=>{const sent=[{path:'src/App.lex.tex',content:source}];return withHostedSourcePermission({purpose:'parse',files:sent},async f=>{const draft=(await (await f(HOSTED_SOURCE_ENDPOINT,rpc('lexlean_draft_write',{profile:'prism-app',files:sent}))).json()).result.structuredContent.draft;if(typeof draft!=='string'||!draft)throw hostedSourceFailure('hostedSourceMalformedResponse');return draft;},opts,fetchImpl);};
// A check through the boundary, with the module and the library it imports: no shell code sends one any more.
const checkForm=(source,fetchImpl,opts={})=>{const sent=[{path:'src/App.lex.tex',content:source},{path:'src/Foundation/View/Browser/V1/Model.lex.tex',content:read('../shell/live/v2/Model.lex.tex')}];return withHostedSourcePermission({purpose:'check',files:sent},async f=>(await f(HOSTED_SOURCE_ENDPOINT,rpc('lexlean_draft_write',{profile:'prism-app',files:sent}))).json(),opts,fetchImpl);};
const rpc=(name,args)=>({method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
function session(boundary={}) {const controller=new AbortController();let current=true;const scope=createHostedSourceSession({appId:7,turnId:'turn-one',source:'blake3:'+'a'.repeat(64),signal:controller.signal,assertCurrent:async()=>current},{...options,...boundary});return {scope,controller,change:()=>{current=false;}};}

test('no default hosted source transmission occurs without permission', async () => {
 let calls=0;await assert.rejects(dataForm('private source',async()=>{calls++;throw Error('network');}),code('hostedSourcePermissionUnavailable'));assert.equal(calls,0);
 await assert.rejects(checkForm('private source',async()=>{calls++;throw Error('network');}),code('hostedSourcePermissionUnavailable'));assert.equal(calls,0);
 const real=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('network');};try{await checkApp(module,{'Foundation.View.Browser.V1.Model':JSON.parse(read('../shell/live/v2/Model.json'))});}finally{globalThis.fetch=real;}assert.equal(calls,0,'the in-tab check sends nothing');
});
test('disclosure is immutable exact source with bounded paths and a fixed destination',()=>{
 const source=structuredClone(input),disclosure=describeHostedSource(source);source.files[0].content='changed';assert.equal(disclosure.files[0].content,files[0].content);assert.ok(Object.isFrozen(disclosure.files[0]));assert.equal(disclosure.endpoint,HOSTED_SOURCE_ENDPOINT);
 for(const patch of [{scope:'unknown'},{purpose:'prove'},{files:[]},{files:[{path:'../secret',content:'x'}]},{files:[...files,...files]},{files:[{path:'src/App.lex.tex',content:'a'.repeat(2097153)}]}])assert.throws(()=>describeHostedSource({...input,...patch}),code('invalidHostedSourcePermission'));
 assert.throws(()=>createHostedSourceSession({appId:7,turnId:'t',source:'s',signal:new AbortController().signal}),code('invalidHostedSourcePermission'));
});
test('dialog denial escape timeout cancellation offline and broken UI are private refusals',async()=>{
 for(const action of ['deny','escape','timeout','abort']){
  const ui=dom(),controller=new AbortController(),result=authorizeHostedSource({...input,signal:controller.signal},{document:ui.document,online:()=>true,timeoutMs:action==='timeout'?5:1000});
  const expected=action==='timeout'?'hostedSourcePermissionExpired':action==='abort'?'hostedSourcePermissionCancelled':'hostedSourcePermissionDenied';const rejected=assert.rejects(result,code(expected));
  assert.equal(ui.document.activeElement,ui.button("Don't send"));
  assert.ok(ui.nodes.find(n=>n.tag==='pre').textContent.includes(files[0].content));
  if(action==='deny')ui.button("Don't send").click();if(action==='escape')ui.nodes.find(n=>n.tag==='dialog').dispatchEvent(new Event('cancel',{cancelable:true}));if(action==='abort')controller.abort();
  await rejected;assert.ok(ui.nodes.find(n=>n.tag==='dialog').removed);
 }
 await assert.rejects(authorizeHostedSource(input,{online:()=>false}),code('hostedSourcePermissionOffline'));
 await assert.rejects(authorizeHostedSource(input,{document:{createElement(){throw Error('private details');}},online:()=>true}),e=>e.code==='hostedSourcePermissionUnavailable'&&!e.message.includes('private'));
});
test('approved browser scope links caller and stop cancellation and cleans its controls',async()=>{
 for(const action of ['caller','stop','complete']){
  const ui=dom(),controller=new AbortController(),result=authorizeHostedSource({...input,signal:controller.signal},{document:ui.document,online:()=>true});
  ui.button('Send this source').click();const permission=await result;
  if(action==='caller')controller.abort();if(action==='stop')ui.button('Stop hosted source transfer').click();if(action==='complete')permission.close();
  assert.equal(permission.signal.aborted,action!=='complete');assert.ok(ui.nodes.find(n=>n.tag==='aside').removed);
 }
});
test('parser and checker require disclosed exact files and strip ambient credentials',async()=>{
 const transport=service();let disclosures=[];const opts={...options,authorize:async value=>{disclosures.push(describeHostedSource(value));return approval(value);}};
 await dataForm(wholePrefix(module).source,transport.fetch,opts);
 await checkForm(module,transport.fetch,opts);
 assert.equal(disclosures.length,2);assert.deepEqual(disclosures.map(d=>d.purpose),['parse','check']);assert.equal(disclosures[1].files.length,2);
 for(const request of transport.requests){assert.equal(request.url,HOSTED_SOURCE_ENDPOINT);assert.equal(request.init.credentials,'omit');assert.equal(request.init.redirect,'error');assert.equal(request.init.headers.authorization,undefined);assert.ok(request.init.signal);}
 assert.deepEqual(JSON.parse(transport.requests[0].init.body).params.arguments.files,disclosures[0].files);
});
test('one turn approval covers later prefixes repairs and checks but never a different turn',async()=>{
 let approvals=0;const boundary={authorize:async value=>{approvals++;assert.equal(value.scope,'turn');assert.equal(value.appId,7);return approval(value);}},one=session(boundary),transport=service();
 try {
  await dataForm('first prefix',transport.fetch,{session:one.scope});await dataForm('repaired module',transport.fetch,{session:one.scope});
  await checkForm(module,transport.fetch,{session:one.scope});assert.equal(approvals,1);
  const two=session(boundary);try{await dataForm('another turn',transport.fetch,{session:two.scope});assert.equal(approvals,2);}finally{two.scope.close();}
 }finally{one.scope.close();}
});
test('a denied turn never repeats its prompt or transmits while a new session can ask',async()=>{
 let prompts=0,calls=0;const one=session({authorize:async()=>{prompts++;throw hostedSourceFailure('hostedSourcePermissionDenied');}});
 try{for(const source of ['one','two'])await assert.rejects(dataForm(source,async()=>calls++,{session:one.scope}),code('hostedSourcePermissionDenied'));assert.equal(prompts,1);assert.equal(calls,0);}finally{one.scope.close();}
});
test('changed ownership revoked expired and offline sessions block further transfer',async()=>{
 for(const action of ['change','abort','close','expire','offline']){
  let time=1000,online=true;const transport=service(),one=session({now:()=>time,online:()=>online,authorize:async value=>({disclosure:describeHostedSource(value),expires:time+1000,signal:new AbortController().signal,close(){}})});
  try{await dataForm('first',transport.fetch,{session:one.scope});const before=transport.requests.length;
   if(action==='change')one.change();if(action==='abort')one.controller.abort();if(action==='close')one.scope.close();if(action==='expire')time=2001;if(action==='offline')online=false;
   const expected=action==='change'?'hostedSourceChanged':action==='expire'?'hostedSourcePermissionExpired':action==='offline'?'hostedSourcePermissionOffline':'hostedSourcePermissionCancelled';
   await assert.rejects(dataForm('second',transport.fetch,{session:one.scope}),code(expected));assert.equal(transport.requests.length,before);
  }finally{one.scope.close();}
 }
});
test('transport rejects changed files endpoints extra fields and out of scope RPC effects',async()=>{
 let calls=0;const fetch=async()=>{calls++;assert.fail('invalid transfer');};
 const bad=[['https://evil.test/',rpc('lexlean_draft_write',{profile:'prism-app',files})],[HOSTED_SOURCE_ENDPOINT,rpc('lexlean_draft_write',{profile:'prism-app',files:[{...files[0],content:'other'}]})],[HOSTED_SOURCE_ENDPOINT,rpc('lexlean_verify',{project:'x'})],[HOSTED_SOURCE_ENDPOINT,rpc('lexlean_draft_read',{draft:'unknown',path:files[0].path,view:'data'})]];
 const extra=rpc('lexlean_draft_write',{profile:'prism-app',files});extra.body=extra.body.replace('"id":1','"id":1,"secret":"undisclosed"');bad.push([HOSTED_SOURCE_ENDPOINT,extra]);
 for(const [url,init] of bad)await assert.rejects(withHostedSourcePermission({purpose:'parse',files},request=>request(url,init),options,fetch),code('invalidHostedSourcePermission'));assert.equal(calls,0);
});
test('malformed refusals and failed transport expose only fixed typed errors',async()=>{
 const cases=[[()=>{throw Error('private bearer');},'hostedSourceNetworkFailed'],[()=>({ok:false}),'hostedSourceServiceRefused'],[()=>({ok:true,json:async()=>{throw Error('private body');}}),'hostedSourceMalformedResponse'],[()=>({ok:true,json:async()=>({result:{structuredContent:{draft:''}}})}),'hostedSourceMalformedResponse'],[()=>({ok:true,json:async()=>({result:{isError:true,structuredContent:{message:'private'}}})}),'hostedSourceServiceRefused']];
 for(const [fetch,expected] of cases)await assert.rejects(dataForm('source',fetch,options),e=>e.code===expected&&!/private|bearer/.test(e.message));
});
test('cancel and bounded deadline interrupt in flight requests even when fetch ignores abort',async()=>{
 for(const action of ['cancel','timeout']){
  const one=session({requestTimeoutMs:action==='timeout'?5:1000});let started;const seen=new Promise(resolve=>started=resolve);
  const operation=dataForm('source',async()=>{started();return new Promise(()=>{});},{session:one.scope});const rejection=assert.rejects(operation,code(action==='timeout'?'hostedSourcePermissionExpired':'hostedSourcePermissionCancelled'));
  await seen;if(action==='cancel')one.controller.abort();await rejection;one.scope.close();
 }
});
test('a build turn and its check send no source: both are read, run and stated in the tab',()=>{
 const host=read('../shell/host.js'),app=read('../shell/live/app.mjs');
 assert.ok(!host.includes('createHostedSourceSession(')&&!app.includes('purpose: "parse"'));assert.ok(!app.includes('hosted-source-permission'));assert.ok(app.includes('createApp(semanticData(source), library)'));
 assert.ok(read('../../app/src/FoundrySpecification.lex.tex').includes('name: hostedSourcePermissionBoundary,'));assert.ok(read('./shell_parse.mjs').includes('"hosted-source-permission.mjs": "mjs"'));
});
