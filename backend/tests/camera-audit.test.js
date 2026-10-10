import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {Store} from '../store.js';
import {createApp} from '../server.js';
import {validateJob} from '../agents.js';
import {cameraAudit} from '../camera-audit.js';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=';
const capture={kind:'camera',mode:'scheduled',frameId:'550e8400-e29b-41d4-a716-446655440000',cameraName:'USB Camera',width:1920,height:1080,capturedAt:new Date().toISOString()};
const job={id:'550e8400-e29b-41d4-a716-446655440001',type:'inspection',scope:'鱼缸01',capture,image,status:'succeeded',reviewStatus:'pending',createdAt:capture.capturedAt,steps:[{id:'vision',name:'视觉 Agent',provider:'qwen',model:'vision-test',status:'succeeded',output:'体表有可见白点，图像不能确认病因。',tools:['read_task_image']},{id:'coordinator',name:'主 Agent',provider:'qwen',status:'succeeded',output:'需人工核对。'}],retrievals:[],sources:[]};

function fetch(url,options={}){return new Promise((resolve,reject)=>{const req=httpRequest(url,{method:options.method||'GET',headers:options.headers},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(options.body);});}

test('camera metadata requires valid provenance and explicit cloud consent',()=>{
  const input={type:'inspection',scope:'鱼缸01',prompt:'观察',image,cloudConsent:true,capture};
  assert.deepEqual(validateJob(input).capture,capture);
  assert.throws(()=>validateJob({...input,cloudConsent:false}));
  assert.throws(()=>validateJob({...input,capture:{...capture,width:0}}));
  assert.throws(()=>validateJob({...input,capture:{...capture,capturedAt:'2020-01-01T00:00:00.000Z'}}));
  assert.throws(()=>validateJob({...input,type:'question'}));
});

test('audit exposes per-frame work and review status without embedding image or secrets',()=>{
  const records=cameraAudit([job,{...job,id:'other',capture:null}],[{at:capture.capturedAt,actor:'local-operator',action:'task_completed',target:job.id,detail:'model completed'}]);
  assert.equal(records.length,1);assert.equal(records[0].observation,job.steps[0].output);
  assert.equal(records[0].reviewStatus,'pending');assert.equal(records[0].steps[0].tools[0],'read_task_image');
  assert.equal(records[0].events[0].action,'task_completed');
  assert.ok(!JSON.stringify(records).includes('base64'));
  job.reviewStatus='reviewed';job.review={reason:'照片不足以判断病因'};
  assert.equal(cameraAudit([job])[0].review.reason,'照片不足以判断病因');
  job.reviewStatus='pending';delete job.review;
});

test('camera audit endpoint requires local session and serves only referenced original image',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'fish-camera-audit-'));
  const store=new Store(path.join(dir,'state.json'));store.data.jobs.push(job);store.save();
  const configFile=path.join(dir,'.env');writeFileSync(configFile,'');
  const app=createApp({store,configFile,configEnv:{},call:async()=>{throw new Error('No paid calls expected');}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const url=`http://127.0.0.1:${app.address().port}/api/agents`;const headers={Host:'127.0.0.1:8000'};
  assert.equal((await fetch(url+'/camera/audit',{headers})).status,401);
  const session=await fetch(url+'/session',{headers});const cookie=session.headers.get('set-cookie').split(';')[0];
  const response=await fetch(url+'/camera/audit',{headers:{...headers,Cookie:cookie}});
  assert.equal(response.status,200);const text=await response.text();assert.ok(text.includes(job.id));assert.ok(!text.includes(image));
  const picture=await fetch(url+'/jobs/'+job.id+'/image',{headers:{...headers,Cookie:cookie}});
  assert.equal(picture.status,200);assert.equal(picture.headers.get('content-type'),'image/png');
});
