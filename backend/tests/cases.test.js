import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../store.js';
import {createApp} from '../server.js';
import {mutateCase,caseDetails,readCaseFile} from '../cases.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=';
const attachment={name:'复查.png',data:png};
function fixture(){
  const base=fileURLToPath(new URL('../data/tests/',import.meta.url));mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(path.join(base,'cases-')),store=new Store(path.join(dir,'state.json')),files=path.join(dir,'review-attachments');
  const add=(scope='验收鱼缸')=>{const j={id:randomUUID(),scope,prompt:'验收观察记录',type:'inspection',image:png,status:'succeeded',reviewStatus:'reviewed',version:2,createdAt:new Date().toISOString(),steps:[],sources:[],result:'可见异常，需继续观察',review:{decision:'needs_evidence',reason:'需进一步核对',at:new Date().toISOString(),attachments:[]}};store.data.jobs.push(j);store.save();return j;};
  const change=(action,id,input,op=randomUUID())=>mutateCase(store,action,id,input,op,files);
  const create=(job=add(),op=randomUUID())=>change('create',null,{jobId:job.id,jobVersion:job.version,title:'验收病例'},op).id;
  return {store,dir,files,add,change,create};
}
test('legacy data adds empty cases without losing existing jobs or audit',()=>{
  const f=fixture(),job=f.add();const legacy={version:1,jobs:[job],audit:[{action:'legacy'}]};writeFileSync(f.store.file,JSON.stringify(legacy));
  const migrated=new Store(f.store.file);assert.deepEqual(migrated.data.jobs,legacy.jobs);assert.deepEqual(migrated.data.audit,legacy.audit);assert.deepEqual(migrated.data.cases,[]);
});
test('case creation requires reviewed completed task, version and preserves review snapshot',()=>{
  const f=fixture(),j=f.add(),review=j.review;delete j.review;assert.throws(()=>f.create(j),/人工核对/);j.review=review;j.status='running';assert.throws(()=>f.create(j),/人工核对/);j.status='succeeded';
  assert.throws(()=>f.change('create',null,{jobId:j.id,jobVersion:1,title:'x'}),/记录已更新/);
  const op=randomUUID(),input={jobId:j.id,jobVersion:2,title:'原始病例'},first=f.change('create',null,input,op);assert.deepEqual(f.change('create',null,input,op),first);assert.equal(f.store.data.cases.length,1);
  assert.throws(()=>f.change('create',null,{...input,title:'不同请求'},op),/操作编号/);
  j.review.reason='后续修改';assert.equal(caseDetails(f.store,first.id).links[0].review.reason,'需进一步核对');assert.equal(j.caseId,first.id);assert.equal(j.version,3);
  assert.throws(()=>f.create(j),/已关联病例/);
});
test('link enforces same scope, optimistic concurrency and one case per task',()=>{
  const f=fixture(),id=f.create(),j=f.add(),other=f.add('另一鱼缸');
  assert.throws(()=>f.change('link',id,{version:1,jobId:other.id,jobVersion:2}),/观察对象不一致/);
  assert.throws(()=>f.change('link',id,{version:0,jobId:j.id,jobVersion:2}),/记录已更新/);
  const op=randomUUID(),input={version:1,jobId:j.id,jobVersion:2};f.change('link',id,input,op);f.change('link',id,input,op);assert.equal(f.store.data.cases[0].links.length,2);assert.equal(j.version,3);
  assert.throws(()=>f.change('link',id,{...input,jobId:other.id},op),/操作编号/);
  const otherCase=f.create();assert.throws(()=>f.change('link',otherCase,{version:1,jobId:j.id,jobVersion:3}),/其他病例/);
});
test('followups persist attachments and idempotency; close and reopen preserve timeline',()=>{
  const f=fixture(),id=f.create(),op=randomUUID(),input={version:1,note:'复查记录',attachments:[attachment,{name:'检查.txt',data:'data:text/plain;base64,'+Buffer.from('实验记录').toString('base64')}],nextReviewAt:'2026-09-21T00:00:00Z'};
  f.change('followup',id,input,op);f.change('followup',id,input,op);let c=caseDetails(f.store,id);assert.equal(c.entries.length,1);assert.equal(c.version,2);assert.equal(readdirSync(f.files).length,2);
  assert.equal(readCaseFile(f.files,c,c.entries[0].attachments[0].id).bytes.toString('base64'),png.split(',')[1]);
  assert.throws(()=>f.change('followup',id,{...input,version:1}),/记录已更新/);
  assert.throws(()=>f.change('followup',id,{version:2,note:'future',observedAt:'2999-01-01'}),/不能晚于/);
  f.change('close',id,{version:2,note:'人工核对后结案'});c=caseDetails(f.store,id);assert.equal(c.status,'closed');assert.equal(c.nextReviewAt,null);
  assert.throws(()=>f.change('followup',id,{version:3,note:'closed'}),/已结案/);const job=f.add();assert.throws(()=>f.change('link',id,{version:3,jobId:job.id,jobVersion:2}),/已结案/);
  f.change('reopen',id,{version:3,note:'发现新的变化'});c=caseDetails(new Store(f.store.file),id);assert.equal(c.status,'observing');assert.deepEqual(c.entries.map(e=>e.kind),['followup','close','reopen']);assert.equal(c.entries[0].attachments.length,2);
  assert.ok(!JSON.stringify(c).includes('creationOperation'));assert.ok(!JSON.stringify(c).includes('base64'));
});
test('failed persistence rolls back case, job link, audit and files',()=>{
  const f=fixture(),j=f.add(),save=f.store.save.bind(f.store);f.store.save=()=>{throw Error('disk full');};assert.throws(()=>f.create(j),/disk full/);assert.equal(j.caseId,undefined);assert.equal(j.version,2);assert.equal(f.store.data.cases.length,0);assert.equal(f.store.data.audit.length,0);
  f.store.save=save;const id=f.create(j),before=readFileSync(f.store.file,'utf8');f.store.save=()=>{throw Error('disk full');};
  assert.throws(()=>f.change('followup',id,{version:1,note:'复查',attachments:[attachment]}),/disk full/);assert.equal(caseDetails(f.store,id).entries.length,0);assert.equal(readdirSync(f.files).length,0);assert.equal(readFileSync(f.store.file,'utf8'),before);
});
const fetch=(url,options={})=>new Promise((resolve,reject)=>{const req=request(url,{method:options.method||'GET',headers:options.headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]))})));});req.on('error',reject);req.end(options.body);});
test('HTTP case workflow protects reads, writes, images and attachment ownership without cloud calls',async t=>{
  const f=fixture(),job=f.add();const app=createApp({store:f.store,configEnv:{},call:async()=>{assert.fail('Cases must not invoke model APIs');}});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const root=`http://127.0.0.1:${app.address().port}/api/agents`,host={Host:'127.0.0.1:8000'};
  assert.equal((await fetch(root+'/cases',{headers:host})).status,401);
  const session=await fetch(root+'/session',{headers:host}),cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json(),headers={...host,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf};
  const post=(route,input,extra={})=>fetch(root+route,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID(),...extra},body:JSON.stringify(input)});
  const input={jobId:job.id,jobVersion:2,title:'HTTP 验收病例'};
  assert.equal((await post('/cases',input,{'X-CSRF-Token':'bad'})).status,403);const created=await post('/cases',input);assert.equal(created.status,200);const {id}=await created.json();
  assert.equal((await fetch(root+'/cases/'+id,{headers:{...headers,Origin:'https://other.test'}})).status,403);
  assert.equal((await post(`/cases/${id}/followup`,{version:1,note:'补充照片',attachments:[attachment]})).status,200);
  const detail=await (await fetch(root+'/cases/'+id,{headers})).json(),file=detail.entries[0].attachments[0],url=root+`/cases/${id}/attachments/${file.id}`;
  assert.equal((await fetch(url,{headers:host})).status,401);const downloaded=await fetch(url,{headers});assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');assert.equal(Buffer.from(await downloaded.arrayBuffer()).toString('base64'),png.split(',')[1]);
  assert.match((await fetch(url+'?download=1',{headers})).headers.get('content-disposition'),/^attachment/);
  const other=f.create();assert.equal((await fetch(root+`/cases/${other}/attachments/${file.id}`,{headers})).status,404);
  assert.equal((await fetch(root+`/jobs/${job.id}/image`,{headers:host})).status,401);assert.equal((await fetch(root+`/jobs/${job.id}/image`,{headers})).status,200);
  const list=await (await fetch(root+'/cases',{headers})).json();assert.equal(list.cases.find(c=>c.id===id).followupCount,1);assert.equal(list.cases.find(c=>c.id===id).taskCount,1);
});
