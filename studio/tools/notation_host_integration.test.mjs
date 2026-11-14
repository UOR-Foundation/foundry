import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import * as appShape from '../shell/live/app.mjs';
import {activeApplicationModule} from '../shell/application-shape.mjs';
import {assertGenerationActive} from '../shell/generation-patch.mjs';

const host = fs.readFileSync(new URL('../shell/host.js', import.meta.url), 'utf8');
const inference = fs.readFileSync(new URL('../shell/inference.js', import.meta.url), 'utf8');
const lines = fs.readFileSync(new URL('./notation/guests.txt', import.meta.url), 'utf8');
const turn = value => `<prism-lexlean>\n${value}</prism-lexlean>`;
const moduleText = appShape.moduleFromTurn(turn(lines)).text.trim() + '\n';
const invalid = turn('app A\ntext name "Name"\nunknown line\n');
const truncated = '<prism-lexlean>\n' + lines.replace(/action "Clear": clear guests\n$/, 'action "Clear": cle');
function sourceBlock(text, start, end) {
  const at = text.indexOf(start), to = text.indexOf(end, at);
  assert.ok(at >= 0 && to > at, `production boundary ${start} must remain`);
  return text.slice(at, to);
}
function turnHarness({stale = false} = {}) {
  const captured = {reference:'captured', files:[]}, log = {checks:[], commits:[], captures:0};
  const run = vm.runInNewContext(sourceBlock(host, 'async function appAfterTurn(', 'const afterTurn =') + ';appAfterTurn', {
    appShape, assertGenerationActive, Map, JSON, enc:new TextEncoder(), coreReady:Promise.resolve(), core:{}, dbReady:Promise.resolve({}),
    captureProjectSource:async()=>{log.captures++;return captured;},
    retiredApplicationPaths:()=>[], lexlean:{canonicalSource(){}}, boundApplicationState:async()=>null,
    kappa:async()=> 'module-identity', now:()=> 'now', nextPhase:async(_phase,event)=>event==='check'?'checked':'drafting',
    checkAppModule:async(source, options)=>{log.checks.push({source,options});return{ok:true,issues:[]};},
    rulesSnapshotOf:async()=>({expected:undefined}), forgetApplicationFrames(){},
    applyStoredProjectPatch:async(_db,_id,patch,options)=>{
      assert.equal(options.source,captured,'notation cannot recapture source before its write');
      if(stale)throw Object.assign(Error('stale source'),{code:'projectEditConflict'});
      log.commits.push({patch,options}); return{changed:patch.writes.length,source:{...captured,files:patch.writes.map(x=>[x.path,x.content])}};
    },
  });
  return{run,captured,log};
}
test('invalid notation leaves captured source and protected standing untouched, including cancellation', async()=>{
  assert.ok(appShape.moduleFromTurn(truncated).text, 'streaming still renders the valid prefix');
  assert.equal(appShape.moduleFromTurn(truncated, {final:true}).text, '', 'final reads do not silently omit a truncated command');
  for (const text of [invalid, truncated]) {
    const h=turnHarness(), abort=new AbortController();
    const result=await h.run(1,text,{source:h.captured,signal:abort.signal});
    assert.equal(result.changed,0);assert.equal(result.source,h.captured);assert.match(result.card,/nothing was changed/);
    assert.equal(h.log.captures,0);assert.equal(h.log.checks.length,0);assert.equal(h.log.commits.length,0);
    abort.abort();await assert.rejects(h.run(1,text,{source:h.captured,signal:abort.signal}),{code:'generationCancelled'});
  }
});
test('notation and expanded module commit together through scoped check and captured lifecycle CAS; direct source edits still work',async()=>{
  const h=turnHarness(), abort=new AbortController(), session={turn:'one'};
  await h.run(1,turn(lines),{source:h.captured,signal:abort.signal,session});
  assert.equal(h.log.checks.length,1);assert.equal(h.log.checks[0].source,moduleText);
  assert.equal(h.log.checks[0].options.signal,abort.signal);assert.equal(h.log.checks[0].options.session,session);
  assert.equal(h.log.commits.length,1);const {patch,options}=h.log.commits[0], files=new Map(patch.writes.map(x=>[x.path,x.content]));
  assert.equal(files.get(appShape.SOURCE_PATH),moduleText);assert.equal(files.get(appShape.NOTATION_PATH),lines);
  assert.equal(options.appUpdate.expected,undefined);assert.equal(options.appUpdate.state.phase,'checked');
  assert.equal(options.appUpdate.state.sourceKappa,'module-identity');assert.equal(options.rulesUpdate.state,null);
  assert.equal(h.log.captures,0);
  const complete=turnHarness();await complete.run(1,'<prism-lexlean>\n'+lines,{source:complete.captured});
  assert.equal(complete.log.commits.length,1,'complete notation lines do not require a closing tag');
  const direct=turnHarness();await direct.run(1,invalid,{source:direct.captured,moduleText});
  assert.equal(direct.log.commits.length,1);assert.equal(direct.log.commits[0].patch.writes.some(x=>x.path===appShape.NOTATION_PATH),false);
  const conflict=turnHarness({stale:true});await assert.rejects(conflict.run(1,turn(lines),{source:conflict.captured}),{code:'projectEditConflict'});
  assert.equal(conflict.log.commits.length,0);
});
test('model context uses notation only from the captured active stateful source and only when equivalent',()=>{
  const selection=sourceBlock(host,'    const moduleNow = activeApplicationModule(projectSource, lexlean.canonicalSource);','    // The route table decides');
  const context=(stored)=>vm.runInNewContext('(async()=>{'+selection+'return request;})()',{
    projectSource:{files:[['prism/AAA.lex.tex','inactive'],[appShape.SOURCE_PATH,moduleText],[appShape.NOTATION_PATH,stored]]},
    activeApplicationModule,lexlean:{canonicalSource(){}},appShape,Map,
    execution:{},chatExecutionPrompt:()=> 'mode instructions',prism:{SPEC_RULES:'rules',moduleContext:()=> 'wrong authority'},
    themeLibrary:async()=>'',appId:1,history:[],intent:{prompt:'edit'},pointedNote:()=>'',
  });
  return (async()=>{
    assert.match((await context(lines))[1].content,/current lines, in the app notation/);
    assert.match((await context(lines.replace('app Guest list','app Other')))[1].content,/current LexLean module/);
  })();
});
test('paid inference preserves exact consent bytes and cancellation with no thinking override; denial sends nothing',async()=>{
  const body=sourceBlock(inference,'async function paidGenerateOnce(','// ---- the route:');
  for(const denied of [false,true]){
    const abort=new AbortController(), log={sent:0,closed:0};
    const run=vm.runInNewContext(body+';paidGenerateOnce',{
      providerOf:()=> 'featherless',inferenceRoute:async()=>({provider:'featherless',key:'test-key',credentialOwner:'user'}),
      coreReady:async()=>({run:()=>({bytes:JSON.stringify({model:'test',stream:true,usage:{include:true},reasoning:{},provider:{}})})}),
      viewReady:async()=>({}),paidId:()=> 'test',location:{origin:'https://foundry.example'},
      authorizeInference:async request=>{
        const bytes=JSON.parse(request.bytes);assert.equal(bytes.chat_template_kwargs,undefined);assert.equal(bytes.usage,undefined);
        assert.equal(bytes.reasoning,undefined);assert.equal(bytes.provider,undefined);assert.equal(bytes.stream_options.include_usage,true);
        assert.equal(request.credentialOwner,'user');assert.equal(request.signal,abort.signal);
        if(denied)throw Object.assign(Error('denied'),{code:'inferenceConsentRequired'});
        return{disclosure:{bytes:'exact-approved-bytes'},signal:abort.signal,close:()=>log.closed++};
      },
      cloudCompletion:async request=>{log.sent++;assert.equal(request.bytes,'exact-approved-bytes');assert.equal(request.signal,abort.signal);return{text:'answer',last:{},finish:'stop'};},
    });
    if(denied){await assert.rejects(run({model:'test'},null,abort.signal,null,{think:false}),{code:'inferenceConsentRequired'});assert.equal(log.sent,0);}
    else{assert.equal((await run({model:'test'},null,abort.signal,null,{think:false})).text,'answer');assert.equal(log.sent,1);assert.equal(log.closed,1);}
  }
  assert.doesNotMatch(host,/k\.ask\("think 0"\)/);
  assert.doesNotMatch(inference,/options\.think|enable_thinking/);
});
