import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from 'node:http';
import {Store} from '../store.js';
import {createApp} from '../server.js';
import {prepareReviewFiles} from '../review-files.js';
import {getHistory} from '../agents.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=';
const upload={name:'补拍.png',data:png};
const text={name:'记录.txt',data:'data:text/plain;base64,'+Buffer.from('观察记录').toString('base64')};
const fetch=(url,options={})=>new Promise((resolve,reject)=>{
  const req=request(url,{method:options.method||'GET',headers:options.headers},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]))})));
  });req.on('error',reject);req.end(options.body);
});

test('review attachments reject spoofed types, traversal, oversized batches and foreign references',()=>{
  assert.equal(prepareReviewFiles({attachments:[upload,text]},{}).pending.length,2);
  for(const file of [{...upload,name:'../x.png'},{...upload,name:'x.html'},{...upload,data:'data:image/png;base64,'+Buffer.from('not image').toString('base64')},{name:'x.svg',data:'data:image/svg+xml;base64,PHN2Zy8+'}])assert.throws(()=>prepareReviewFiles({attachments:[file]},{}));
  assert.throws(()=>prepareReviewFiles({attachments:Array(5).fill(upload)},{}));
  const big={name:'big.txt',data:'data:text/plain;base64,'+Buffer.alloc(3*1024*1024,65).toString('base64')};
  assert.throws(()=>prepareReviewFiles({attachments:[big,big]},{}));
  assert.throws(()=>prepareReviewFiles({retainedAttachmentIds:['other-job-file']},{}));
});

test('review files persist, require authentication, preserve revisions, and never enter cloud history',async(t)=>{
  const base=fileURLToPath(new URL('../data/tests/',import.meta.url));mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(path.join(base,'review-')),stateFile=path.join(dir,'state.json'),store=new Store(stateFile);
  const job={id:'11111111-1111-4111-8111-111111111111',scope:'test',type:'inspection',status:'succeeded',reviewStatus:'pending',version:1,steps:[],result:'观察结果'};
  store.data.jobs.push(job);store.save();
  const app=createApp({store,configEnv:{},call:async()=>{throw Error('Review must not call cloud models');}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const url=`http://127.0.0.1:${app.address().port}/api/agents`,host={Host:'127.0.0.1:8000'};
  const session=await fetch(url+'/session',{headers:host}),cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
  const headers={...host,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf};
  const send=payload=>fetch(url+'/jobs/'+job.id+'/review',{method:'POST',headers,body:JSON.stringify(payload)});
  const input={version:1,decision:'needs_evidence',reason:'补拍记录',attachments:[upload,text]};
  assert.equal((await fetch(url+'/jobs/'+job.id+'/review',{method:'POST',headers:{...headers,'X-CSRF-Token':'bad'},body:JSON.stringify(input)})).status,403);
  assert.equal((await send(input)).status,200);
  const file=job.review.attachments[0],fileUrl=url+'/jobs/'+job.id+'/attachments/'+file.id;
  assert.equal(job.version,2);
  assert.equal((await fetch(fileUrl,{headers:host})).status,401);
  assert.equal((await fetch(fileUrl,{headers:{...headers,Origin:'https://evil.test'}})).status,403);
  const content=await fetch(fileUrl,{headers});assert.equal(content.status,200);assert.equal(content.headers.get('x-content-type-options'),'nosniff');
  assert.equal(Buffer.from(await content.arrayBuffer()).toString('base64'),png.split(',')[1]);
  assert.match((await fetch(fileUrl+'?download=1',{headers})).headers.get('content-disposition'),/^attachment/);
  assert.equal((await send(input)).status,409);assert.equal(readdirSync(path.join(dir,'review-attachments')).length,2);
  assert.equal((await send({version:2,decision:'accepted',reason:'复核完成',retainedAttachmentIds:[]})).status,200);
  assert.equal(job.review.attachments.length,0);assert.equal(job.reviewHistory.length,1);
  assert.equal((await fetch(fileUrl,{headers})).status,200);
  const disk=JSON.parse(readFileSync(stateFile,'utf8'));assert.equal(disk.jobs[0].reviewHistory[0].attachments[0].id,file.id);
  assert.ok(!JSON.stringify(getHistory(store,'test','other',true)).includes('attachments'));
  const reloaded=new Store(stateFile);assert.equal(reloaded.data.jobs[0].reviewHistory[0].attachments.length,2);
  const other={...job,id:'22222222-2222-4222-8222-222222222222',review:undefined,reviewHistory:[]};store.data.jobs.push(other);
  assert.equal((await fetch(url+'/jobs/'+other.id+'/attachments/'+file.id,{headers})).status,404);
});
