import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import {deviceProviderCredential} from '../shell/private-provider-credentials.mjs';
import {checkStagedShell} from './check_shell_closure.mjs';
import {invokeHost} from '../shell/host-boundary.mjs';
const source=fs.readFileSync(new URL('../shell/inference.js',import.meta.url),'utf8');
const settings=(provider,value)=>({providerSettings:{[provider]:{apiKey:{value}}}});
test('device credentials are bounded primitives and malformed settings fail privately',async()=>{
 for(const provider of ['openrouter','featherless']){
  assert.equal(deviceProviderCredential(null,provider),'');assert.equal(deviceProviderCredential(settings(provider,''),provider),'');assert.equal(deviceProviderCredential(settings(provider,'fixture-private'),provider),'fixture-private');
  for(const value of [7,{},'a b','x\ny','é','x'.repeat(8193)])assert.throws(()=>deviceProviderCredential(settings(provider,value),provider),e=>e.code==='invalidStoredProviderCredential'&&!e.message.includes(String(value)));
 }
 assert.throws(()=>deviceProviderCredential({},'unknown'),{code:'unsupportedCredentialProvider'});
 const result=await invokeHost('get-env-vars',[],()=>deviceProviderCredential(settings('openrouter',{}),'openrouter'));assert.equal(result.error.code,'invalidStoredProviderCredential');assert.ok(!result.error.message.includes('[object'));
});
test('actual credential accessors use settings only with no public fallback or fetch',async()=>{
 let stored=null,requests=0;const text=source.slice(source.indexOf('export async function deviceKeyGet()'),source.indexOf('export const providerOf')).replaceAll('export ','');
 const api=vm.runInNewContext(text+'\n({keyGet,featherlessKeyGet})',{deviceProviderCredential,settingsGet:async()=>stored,fetch:()=>{requests++;return Response.json({key:'public-fixture',featherless:'public-fixture'});}});
 assert.equal(await api.keyGet(),'');assert.equal(await api.featherlessKeyGet(),'');stored=settings('openrouter','visitor-one');assert.equal(await api.keyGet(),'visitor-one');assert.equal(await api.featherlessKeyGet(),'');stored=settings('featherless','visitor-two');assert.equal(await api.featherlessKeyGet(),'visitor-two');assert.equal(requests,0);
});
test('actual paid inference refuses missing key before consent and identifies captured visitor ownership',async()=>{
 const text=source.slice(source.indexOf('async function paidGenerateOnce('),source.indexOf('// ---- the route:',source.indexOf('async function paidGenerateOnce(')));
 let key='',consents=0,effects=0,closed=0,disclosure,passed;const run=vm.runInNewContext(text+'\npaidGenerateOnce',{providerOf:()=> 'openrouter',inferenceRoute:async()=>({kind:'visitorOpenRouter',provider:'openrouter',key,credentialOwner:'visitor'}),paidId:x=>x.replace('openrouter/',''),coreReady:async()=>({run:()=>({bytes:'{"messages":[]}'})}),viewReady:async()=>({}),location:{origin:'https://example.test'},authorizeInference:async input=>{consents++;disclosure=input;return {disclosure:input,close(){closed++;}};},cloudCompletion:async input=>{effects++;passed=input;return {last:{},text:'answer',finish:'stop',ttftMs:1};}});
 await assert.rejects(run({model:'openrouter/model'}),{code:'inferenceUnauthorized'});assert.equal(consents,0);assert.equal(effects,0);key='visitor-fixture';assert.equal((await run({model:'openrouter/model'})).text,'answer');assert.equal(disclosure.credentialOwner,'visitor');assert.equal(passed.key,'visitor-fixture');assert.ok(!JSON.stringify(disclosure).includes('visitor-fixture'));assert.equal(closed,1);
});
test('actual environment projection names the studio model alone and no key',async()=>{
 const host=fs.readFileSync(new URL('../shell/host.js',import.meta.url),'utf8'),line=host.split('\n').find(line=>line.startsWith('handlers.set("get-env-vars"'));const handlers=new Map();vm.runInNewContext(line,{handlers,navigator:{}});const value=await handlers.get('get-env-vars')();assert.deepEqual(Object.keys(value),['HOLOGRAM_DEVICE'],'set up without WebGPU too, and no remote provider or key is ever advertised');
});
test('independent release inventory refuses root nested and empty credential files',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'foundry-credential-test-'));try{for(const relative of ['warmup.json','nested/warmup.json']){const file=path.join(directory,relative);fs.mkdirSync(path.dirname(file),{recursive:true});for(const bytes of ['','{"key":"fixture-only"}']){fs.writeFileSync(file,bytes);await assert.rejects(checkStagedShell(directory),{code:'providerCredentialArtifact'});}fs.unlinkSync(file);}}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('release workflows projector and browser gates cannot silently restore public credentials',()=>{
 const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8'),pages=read('../../.github/workflows/pages.yml');assert.ok(!pages.includes('secrets.OPENROUTER_WARMUP_KEY'));assert.ok(!pages.includes('secrets.FEATHERLESS_SITE_KEY'));assert.ok(!pages.includes("open('shell/warmup.json'"));assert.ok(!source.includes('warmup.json'));assert.ok(!source.includes('siteKeyReady'));assert.ok(read('../core/src/bin/project_shell.rs').includes('providerCredentialArtifact: public credential file refused'));assert.ok(read('./shell_parse.mjs').includes('private-provider-credentials.mjs'));const workflow=read('../../.github/workflows/studio.yml');assert.ok(workflow.includes('node tools/private_provider_credentials_browser.mjs'));assert.ok(workflow.includes('node tools/private_provider_credentials_artifact.mjs'));
});
