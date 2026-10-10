import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {AppError,complete,publicConfig} from '../providers.js';
import {SEARCH_TOOL,searchRag,ragStatus} from '../rag.js';
import {runJob,ROLES} from '../agents.js';
import {Store} from '../store.js';
const rag={url:'https://rag.example.test/api/search',allowedOrigin:'https://rag.example.test',key:'test-rag-secret'};
const config={qwen:{id:'qwen',baseUrl:'https://example.test',model:'test',key:'test-model-key'},deepseek:{id:'deepseek',baseUrl:'https://example.test',model:'test',key:'test-deepseek-key'},rag};
const fixture=()=>{const base=fileURLToPath(new URL('../data/tests/',import.meta.url));mkdirSync(base,{recursive:true});const store=new Store(path.join(mkdtempSync(path.join(base,'rag-')),'state.json'));const job={id:'test',type:'question',prompt:'鳞片竖立鉴别依据',scope:'test',includeHistory:false,status:'queued',steps:ROLES.map(r=>({...r,status:'queued'}))};store.data.jobs.push(job);return{job,store,config,signal:new AbortController().signal};};
const tc=(name='search_fish_knowledge')=>({id:'call-1',type:'function',function:{name,arguments:JSON.stringify({query:'鳞片竖立',reason:'需要鉴别依据'})}});

test('RAG sends credential only to the explicitly allowed origin and preserves absent page',async()=>{
 let captured;
 const sources=await searchRag(rag,'鳞片竖立',{fetcher:async(url,init)=>{captured={url,init};return new Response(JSON.stringify({sources:[{name:'test.pdf',snippet:'观察记录',documentId:'doc-1',score:0.7}]}));}});
 assert.equal(captured.init.headers['X-API-Key'],rag.key);assert.equal(captured.init.redirect,'error');assert.equal(sources[0].page,null);assert.equal(sources[0].text,'观察记录');
 await assert.rejects(searchRag({...rag,url:'https://evil.test/api/search'},'query'),e=>e.code==='RAG_CONFIG');
 assert.ok(!JSON.stringify({providers:publicConfig(config),rag:ragStatus(rag)}).includes(rag.key));
});
test('RAG rejects incomplete, credential-bearing and unapproved URLs before network access',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({sources:[]});};
 for(const fields of [{key:''},{url:''},{allowedOrigin:''}])await assert.rejects(searchRag({...rag,...fields},'query',{fetcher}),e=>e.code==='RAG_NOT_CONFIGURED');
 for(const fields of [
  {url:'http://rag.example.test/api/search'},
  {url:'https://rag.example.test.evil.test/api/search'},
  {url:'https://rag.example.test@evil.test/api/search'},
  {url:'https://user:password@rag.example.test/api/search'},
  {url:'https://rag.example.test/api/search?key=test'},
  {url:'https://rag.example.test/api/search#key'},
  {url:'https://rag.example.test/api/search?'},
  {url:'https://rag.example.test/api/search#'},
  {allowedOrigin:'https://rag.example.test/path'},
  {allowedOrigin:'https://rag.example.test/'},
  {allowedOrigin:'http://rag.example.test'},
  {allowedOrigin:'not-a-url'},
 ])await assert.rejects(searchRag({...rag,...fields},'query',{fetcher}),e=>e.code==='RAG_CONFIG');
 assert.equal(calls,0);
 assert.equal(ragStatus({...rag,allowedOrigin:''}).url,'');
});
test('empty RAG differs from auth, server, JSON and schema failures',async()=>{
 assert.deepEqual(await searchRag(rag,'query',{fetcher:async()=>new Response('{"sources":[]}')}),[]);
 for(const status of [401,500])await assert.rejects(searchRag(rag,'query',{fetcher:async()=>new Response(rag.key,{status})}),e=>e.code==='RAG_UPSTREAM'&&!e.message.includes(rag.key));
 for(const data of ['not JSON','{"error":"failure","sources":[]}','{"sources":[{}]}'])await assert.rejects(searchRag(rag,'query',{fetcher:async()=>new Response(data)}),e=>e.code==='RAG_FORMAT');
});
test('provider accepts genuine tool-only response and transmits tool definitions',async()=>{
 let body;
 const response=await complete(config.qwen,[],{tools:[SEARCH_TOOL],fetcher:async(url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[tc()]}}]}));}});
 assert.equal(response.toolCalls[0].function.name,'search_fish_knowledge');assert.equal(body.enable_thinking,false);assert.equal(body.tools[0].function.name,'search_fish_knowledge');
});
test('Qwen chooses retrieval, receives source text, and persists actual citations',async()=>{
 const f=fixture();let calls=0,retrievals=0;
 await runJob(f.job,{...f,call:async(p,m)=>{calls++;if(calls===1)return{text:'',toolCalls:[tc()]};assert.equal(m.at(-1).role,'tool');assert.ok(m.at(-1).content.includes('实际资料片段'));return{text:'需要进一步核对 [R1]'};},retrieve:async()=>{retrievals++;return[{title:'资料',source:'资料',text:'实际资料片段',documentId:'doc-1'}];}});
 assert.equal(f.job.status,'succeeded');assert.equal(retrievals,1);assert.equal(f.job.sources[0].id,'R1');assert.equal(f.job.reviewStatus,'pending');assert.equal(f.job.retrievals[0].status,'succeeded');
});
test('direct answer never retrieves; unknown tools never reach external service',async()=>{
 for(const unknown of [false,true]){const f=fixture();let count=0;await runJob(f.job,{...f,call:async()=>unknown?{text:'',toolCalls:[tc('delete_database')]}:{text:'您好'},retrieve:async()=>{count++;return[];}});assert.equal(count,0);assert.equal(f.job.status,unknown?'failed':'succeeded');}
});
test('failed retrieval cannot become empty or a completed diagnosis',async()=>{
 const f=fixture();await runJob(f.job,{...f,call:async()=>({text:'',toolCalls:[tc()]}),retrieve:async()=>{throw new AppError('知识库连接失败','RAG_CONNECTION');}});
 assert.equal(f.job.status,'failed');assert.equal(f.job.result,undefined);assert.equal(f.job.retrievals[0].status,'failed');
});
test('tool budget bounds repeated calls and rejects invented citation',async()=>{
 const f=fixture();let retrieves=0;await runJob(f.job,{...f,call:async()=>({text:'',toolCalls:[tc()]}),retrieve:async()=>{retrieves++;return[];}});assert.equal(retrieves,2);assert.equal(f.job.status,'failed');
 const g=fixture();await runJob(g.job,{...g,call:async()=>({text:'结论 [R9]'})});assert.equal(g.job.status,'failed');assert.equal(g.job.result,undefined);
});
test('cancelled retrieval result does not finish job or persist late sources',async()=>{
 const f=fixture(),controller=new AbortController();await runJob(f.job,{...f,signal:controller.signal,call:async()=>({text:'',toolCalls:[tc()]}),retrieve:async()=>{f.job.status='cancelled';controller.abort();return[{text:'late'}];}});assert.equal(f.job.status,'cancelled');assert.deepEqual(f.job.sources,[]);
});
