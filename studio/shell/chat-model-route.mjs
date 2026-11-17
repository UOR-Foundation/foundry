// FoundrySpecification.chatProviderRoutingBoundary: no implicit engine substitution.
import {LargeLanguageModelSchema} from './chat-contracts.mjs';
// Foundry's local models: its reader, plus the pinned in-Prism LexLean-R4 Studio. A selection stored under a former name resolves to Foundry's reader.
export const LOCAL_MODEL='foundry:reader',INPRISM_MODEL='r4:lexlean-r4';const FORMER=['webgpu:Qwen','webgpu:Bonsai','webgpu:BitNet'];
const fail=code=>Object.assign(new Error(code==='unsupportedChatProvider'?'The chat provider is unsupported':'The chat model selection is invalid'),{code});
export function chatModelRoute(chatSelection,defaultSelection){
 const chosen=chatSelection??defaultSelection;
 try{
  LargeLanguageModelSchema.parse(chosen);
  for(const value of [chosen?.provider,chosen?.name])if(typeof value!=='string'||!value.length||value.length>256||value.trim()!==value||/[\x00-\x1f\x7f]/.test(value))throw Error();
 }catch{throw fail('invalidChatModelSelection');}
 const {provider,name}=chosen;
 if(!['local','openrouter','featherless'].includes(provider))throw fail('unsupportedChatProvider');
 if(provider==='local'&&name!==LOCAL_MODEL&&name!==INPRISM_MODEL&&!FORMER.includes(name))throw fail('invalidChatModelSelection');
 return Object.freeze({provider,model:provider==='local'?(name===INPRISM_MODEL?INPRISM_MODEL:LOCAL_MODEL):provider+'/'+name,paid:provider!=='local'});
}
