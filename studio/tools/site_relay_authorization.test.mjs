import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {deviceInferenceRoute} from '../shell/private-provider-credentials.mjs';
import {describeInference} from '../shell/inference-consent.mjs';
import {cloudCompletion,RELAY} from '../shell/inference-effects.mjs';
const settings=(provider,value)=>({providerSettings:{[provider]:{apiKey:{value}}}});
const stream=()=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'answer'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
test('finite routes preserve visitor ownership even when credential bytes equal the old marker',()=>{
 assert.deepEqual(deviceInferenceRoute(null,'featherless'),{kind:'siteFeatherless',provider:'featherlessSite',key:'',credentialOwner:'site'});
 for(const provider of ['openrouter','featherless'])for(const key of ['visitor-key','site-relay']){const route=deviceInferenceRoute(settings(provider,key),provider);assert.equal(route.kind,provider==='openrouter'?'visitorOpenRouter':'visitorFeatherless');assert.equal(route.provider,provider);assert.equal(route.key,key);assert.equal(route.credentialOwner,'visitor');assert.ok(Object.isFrozen(route));}
 assert.equal(deviceInferenceRoute(null,'openrouter').key,'');
});
test('malformed device credentials and unknown providers cannot become a relay route',()=>{
 for(const value of [{},'a b',8,'é','x'.repeat(8193)])assert.throws(()=>deviceInferenceRoute(settings('featherless',value),'featherless'),{code:'invalidStoredProviderCredential'});
 assert.throws(()=>deviceInferenceRoute({},'unknown'),{code:'unsupportedCredentialProvider'});
});
test('disclosures bind site ownership only to the declared relay and expose no credential',()=>{
 const input={provider:'featherlessSite',model:'fixture',bytes:'{"messages":[]}',credentialOwner:'site'},view=describeInference(input);assert.equal(view.endpoint,RELAY);assert.equal(view.credentialOwner,'site');assert.ok(!Object.hasOwn(view,'key'));
 for(const patch of [{credentialOwner:'visitor'},{provider:'featherless'},{provider:'openrouter'}])assert.throws(()=>describeInference({...input,...patch}),{code:'invalidInferenceConsent'});
});
test('actual relay transport omits authorization cookies and redirects and rejects credentials',async()=>{
 let calls=0,options;const fetch=async(url,input)=>{calls++;assert.equal(url,RELAY);options=input;return stream();};const result=await cloudCompletion({provider:'featherlessSite',key:'',bytes:'{}'},{fetch});assert.equal(result.text,'answer');assert.equal(new Headers(options.headers).has('authorization'),false);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
 await assert.rejects(()=>cloudCompletion({provider:'featherlessSite',key:'private',bytes:'{}'},{fetch}),{code:'invalidInferenceRequest'});assert.equal(calls,1);
});
test('actual paid adapter obtains consent for the captured tagged route before any effect',async()=>{
 const source=fs.readFileSync(new URL('../shell/inference.js',import.meta.url),'utf8'),start=source.indexOf('async function paidGenerateOnce'),end=source.indexOf('// ---- the route:',start),body=source.slice(start,end)+'\npaidGenerateOnce';
 for(const key of ['', 'site-relay'])for(const allow of [false,true]){
  const route=deviceInferenceRoute(settings('featherless',key),'featherless'),controller=new AbortController();let calls=0,closed=0,disclosed;
  const paid=vm.runInNewContext(body,{providerOf:()=> 'featherless',inferenceRoute:async()=>route,paidId:()=> 'fixture',coreReady:async()=>({run:()=>({bytes:'{"messages":[],"stream":true}'})}),viewReady:async()=>({}),location:{origin:'https://foundry.test'},authorizeInference:async input=>{disclosed=input;assert.equal(input.provider,route.provider);assert.equal(input.credentialOwner,route.credentialOwner);assert.ok(!Object.hasOwn(input,'key'));if(!allow)throw Object.assign(Error('declined'),{code:'inferenceConsentDenied'});return {disclosure:input,signal:controller.signal,close(){closed++;}};},cloudCompletion:async input=>{calls++;assert.equal(input.provider,route.provider);assert.equal(input.key,key);assert.equal(input.bytes,disclosed.bytes);assert.equal(input.signal,controller.signal);return {last:{},text:'answer',finish:'stop',ttftMs:1};}});
  if(allow){assert.equal((await paid({model:'featherless/fixture'})).text,'answer');assert.equal(calls,1);assert.equal(closed,1);}else{await assert.rejects(()=>paid({model:'featherless/fixture'}),{code:'inferenceConsentDenied'});assert.equal(calls,0);}
 }
});
test('main integration preserves qualified guest and the complete modeled privacy and factory boundaries',()=>{
 const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');for(const name of ['siteRelayBoundary','InferenceCredentialRoute'])assert.ok(read('app/src/FoundrySpecification.lex.tex').includes('name: '+name+','));
 assert.equal(JSON.parse(read('studio/shell/kernel/kernel.json')).vectors.length,322);assert.ok(read('.github/workflows/studio.yml').includes('node tools/site_relay_authorization_browser.mjs'));assert.ok(read('Justfile').includes('pull_request|merge_group)'));assert.ok(read('Justfile').includes('prismpm --project app verify'));
 assert.ok(!read('studio/shell/inference.js').includes('warmup.json'));assert.ok(read('.github/workflows/pages.yml').includes('would publish a provider key'));assert.ok(read('model/ids.toml').includes('id = "AC-01"'));
});
