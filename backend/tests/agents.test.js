import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {AppError,complete,publicConfig} from '../providers.js';
import {authorizeTool,validateJob,preflight,getHistory,runJob,ROLES} from '../agents.js';
import {Store} from '../store.js';
import {createApp} from '../server.js';

const provider={id:'deepseek',baseUrl:'https://api.example.test/v1',model:'test-model',key:'secret-not-for-browser'};
const config={deepseek:provider,qwen:{...provider,id:'qwen'}};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=';
function fixture(){const base=fileURLToPath(new URL('../data/tests/',import.meta.url));mkdirSync(base,{recursive:true});const dir=mkdtempSync(path.join(base,'run-'));const knowledgeFile=path.join(dir,'knowledge.json');writeFileSync(knowledgeFile,'[]');return {dir,knowledgeFile,store:new Store(path.join(dir,'state.json'))};}
function job(type='inspection'){return {id:'test-job',scope:'pond-A',type,prompt:'观察鱼体白点',image:png,includeHistory:false,status:'queued',createdAt:new Date().toISOString(),steps:ROLES.map(r=>({id:r.id,name:r.name,status:'queued'}))};}

test('cloud request contains server credential; errors do not echo upstream secret',async()=>{
  let request;
  const response=await complete(provider,[{role:'user',content:'hello'}],{fetcher:async(url,init)=>{request={url,init};return new Response(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}],usage:{total_tokens:3}}));}});
  assert.equal(request.url,'https://api.example.test/v1/chat/completions');assert.equal(request.init.headers.Authorization,'Bearer '+provider.key);assert.equal(response.text,'OK');
  await assert.rejects(complete(provider,[],{fetcher:async()=>new Response(provider.key,{status:401})}),e=>!e.message.includes(provider.key)&&e.message.includes('401'));
  assert.ok(!JSON.stringify(publicConfig(config)).includes(provider.key));
});
test('missing Qwen blocks image work without silently using text model',()=>{
  assert.throws(()=>preflight({type:'inspection'},{...config,qwen:{}}),e=>e.code==='NOT_CONFIGURED');
  assert.throws(()=>preflight({type:'question'},{...config,qwen:{}})); assert.doesNotThrow(()=>preflight({type:'question'},{...config,deepseek:{}}));
});
test('body timeout and interrupted body are not mislabeled as malformed JSON',async()=>{
  const failBody=error=>async()=>({ok:true,json:async()=>{throw error;}});
  await assert.rejects(complete(provider,[],{fetcher:failBody(new DOMException('timeout','TimeoutError'))}),e=>e.code==='UPSTREAM_TIMEOUT');
  await assert.rejects(complete(provider,[],{fetcher:failBody(new TypeError('private upstream body',{cause:{code:'UND_ERR_SOCKET'}}))}),e=>e.code==='UPSTREAM_CONNECTION'&&e.message.includes('连接中断')&&!e.message.includes('private'));
  await assert.rejects(complete(provider,[],{fetcher:async()=>new Response('<html>gateway</html>')}),e=>e.code==='UPSTREAM_FORMAT');
  const controller=new AbortController();
  await assert.rejects(complete(provider,[],{signal:controller.signal,fetcher:async()=>({ok:true,json:async()=>{controller.abort();throw new DOMException('aborted','AbortError');}})}),e=>e.code==='CANCELLED');
});
test('image format and explicit cloud consent are required',()=>{
  const valid={type:'inspection',scope:'tank',prompt:'look',image:png,cloudConsent:true};
  assert.ok(validateJob(valid).image);assert.throws(()=>validateJob({...valid,cloudConsent:false}));
  assert.throws(()=>validateJob({...valid,image:'https://unknown.test/private'}));
  assert.throws(()=>validateJob({...valid,image:'data:image/png;base64,YWJjZGVmZ2hp'}));
});
test('roles cannot review or delete, history is limited to permitted scope and opt-in',()=>{
  for(const r of ROLES)assert.throws(()=>authorizeTool(r.id,'approve_case'),e=>e.code==='FORBIDDEN');
  const store={data:{jobs:[{id:'1',scope:'pond-A',status:'succeeded',result:'a'},{id:'2',scope:'pond-B',status:'succeeded',result:'b'}]}};
  assert.deepEqual(getHistory(store,'pond-A','current',false),[]);
  assert.deepEqual(getHistory(store,'pond-A','current',true).map(j=>j.id),['1']);
});
test('image workflow uses correct providers, no invented RAG, persists pending review',async()=>{
  const f=fixture(),j=job(),calls=[];f.store.data.jobs.push(j);
  await runJob(j,{...f,config,signal:new AbortController().signal,call:async(p,m)=>{calls.push({provider:p.id,messages:m});return{text:calls.length===1?JSON.stringify({fishVisible:false,quality:'unusable',features:[],description:'画面无鱼',limitations:'无法观察鱼体'}):'真实请求测试替身结果',usage:{total_tokens:2}};}});
  assert.deepEqual(calls.map(c=>c.provider),['qwen','qwen','deepseek']);assert.equal(j.status,'succeeded');assert.equal(j.reviewStatus,'pending');assert.deepEqual(j.sources,[]);assert.equal(j.steps.filter(s=>s.status==='succeeded').length,3);
  assert.ok(Array.isArray(calls[0].messages[1].content));assert.ok(!JSON.stringify(calls[2]).includes(png));
  assert.equal(j.steps.find(s=>s.id==='evidence').status,'skipped');
});
test('question skips other roles, failure does not become success',async()=>{
  const f=fixture(),j=job('question');f.store.data.jobs.push(j);let count=0;
  await runJob(j,{...f,config,signal:new AbortController().signal,call:async()=>{count++;throw new AppError('upstream unavailable');}});
  assert.equal(count,1);assert.equal(j.status,'failed');assert.equal(j.result,undefined);assert.equal(j.steps[1].status,'skipped');
});
test('cancelled late result cannot finish the workflow',async()=>{
  const f=fixture(),j=job(),controller=new AbortController();f.store.data.jobs.push(j);
  await runJob(j,{...f,config,signal:controller.signal,call:async()=>{j.status='cancelled';controller.abort();return{text:'late'};}});
  assert.equal(j.status,'cancelled');assert.equal(j.result,undefined);
});
test('HTTP origin, session, CSRF, idempotency and malformed body guards',async(t)=>{
  // Node fetch controls the Host header. Use HTTP directly to exercise the production host allowlist on an ephemeral test port.
  const fetch=(url,options={})=>new Promise((resolve,reject)=>{const req=httpRequest(url,{method:options.method||'GET',headers:options.headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]))})));});req.on('error',reject);req.end(options.body);});
  const f=fixture(),configFile=path.join(f.dir,'.env');
  const fixtureConfig={
    DEEPSEEK:{...provider,model:'test'},QWEN:{...provider,id:'qwen',model:'test'},
  };
  const configFields={BASE_URL:'baseUrl',MODEL:'model',API_KEY:'key'};
  const envEntries=Object.entries(fixtureConfig).flatMap(([prefix,settings])=>
    Object.entries(configFields).map(([field,property])=>[`${prefix}_${field}`,settings[property]])
  );
  writeFileSync(configFile,envEntries.map(([name,value])=>`${name}=${value}`).join('\n'));
  let calls=0;const app=createApp({...f,configFile,configEnv:{},call:async()=>{calls++;return{text:'test answer',usage:{}};}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const url=`http://127.0.0.1:${app.address().port}/api/agents`;
  const headers={Host:'127.0.0.1:8000'};
  assert.equal((await fetch(url+'/providers',{headers})).status,401);
  assert.equal((await fetch(url+'/session',{headers:{...headers,Origin:'https://evil.test'}})).status,403);
  const session=await fetch(url+'/session',{headers});const cookie=session.headers.get('set-cookie').split(';')[0];const {csrf}=await session.json();
  const h={...headers,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()};
  assert.equal((await fetch(url+'/jobs',{method:'POST',headers:{...h,'X-CSRF-Token':'wrong'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/jobs',{method:'POST',headers:h,body:'broken'})).status,400);
  const payload={type:'question',scope:'pond-A',prompt:'test',cloudConsent:true};
  const first=await fetch(url+'/jobs',{method:'POST',headers:h,body:JSON.stringify(payload)});assert.equal(first.status,202);const id=(await first.json()).id;
  const second=await fetch(url+'/jobs',{method:'POST',headers:h,body:JSON.stringify(payload)});assert.equal((await second.json()).id,id);assert.equal(calls,1);
  assert.equal((await fetch(url+'/jobs',{method:'POST',headers:h,body:JSON.stringify({...payload,prompt:'different'})})).status,409);
  const status=await(await fetch(url+'/providers',{headers:{...headers,Cookie:cookie}})).text();assert.ok(!status.includes(provider.key));
  const reviewed={...job(),id:'11111111-1111-4111-8111-111111111111',status:'succeeded',version:1};
  f.store.data.jobs.push(reviewed);
  const reviewBody={version:1,decision:'needs_evidence',reason:'需要更清晰的鳃部照片'};
  const reviewUrl=url+'/jobs/'+reviewed.id+'/review';
  assert.equal((await fetch(reviewUrl,{method:'POST',headers:h,body:JSON.stringify(reviewBody)})).status,200);
  assert.equal(reviewed.version,2);assert.equal(reviewed.reviewStatus,'reviewed');
  assert.equal((await fetch(reviewUrl,{method:'POST',headers:h,body:JSON.stringify({...reviewBody,decision:'accepted'})})).status,409);
  assert.equal(reviewed.review.decision,'needs_evidence');
});

test('network interruption, 90-second timeout, and cancellation remain distinct without leaking upstream text',async()=>{
  await assert.rejects(complete(provider,[],{fetcher:async()=>{throw new TypeError('private diagnostic '+provider.key,{cause:{code:'ECONNRESET'}});}}),e=>e.code==='UPSTREAM_CONNECTION'&&e.message.includes('连接被重置')&&!e.message.includes('90 秒')&&!e.message.includes(provider.key));
  await assert.rejects(complete(provider,[],{fetcher:async()=>{throw new DOMException('timeout','TimeoutError');}}),e=>e.code==='UPSTREAM_TIMEOUT');
  const controller=new AbortController();controller.abort();
  await assert.rejects(complete(provider,[],{signal:controller.signal,fetcher:async()=>{throw new Error('cancelled');}}),e=>e.code==='CANCELLED');
});
