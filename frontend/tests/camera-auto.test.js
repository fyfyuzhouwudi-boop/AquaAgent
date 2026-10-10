import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraAutoAnalyzer} from '../src/camera-auto.js';
const frame={id:'frame-1',camera:'USB',scope:'tank',width:640,height:480,capturedAt:new Date().toISOString(),image:'test-image'};
test('automatic cloud calls require enabling, respect cooldown, wait for active job and stop at ten',async()=>{
  let clock=0,posts=0,status='running';const payloads=[];
  const runner=new CameraAutoAnalyzer({now:()=>clock,request:async(path,body,key)=>{if(!body)return {status};posts++;payloads.push({body,key});return {id:'job-'+posts};}});
  assert.equal(await runner.submit(frame),'disabled');assert.equal(posts,0);
  runner.resume();assert.equal(await runner.submit(frame),'submitted');
  clock=10000;assert.equal(await runner.submit(frame),'cooldown');clock=60000;assert.equal(await runner.submit(frame),'running');assert.equal(posts,1);
  status='succeeded';for(let i=1;i<10;i++){clock=i*60000;assert.equal(await runner.submit({...frame,id:'frame-'+(i+1)}),'submitted');}
  clock+=60000;assert.equal(await runner.submit(frame),'disabled');assert.equal(posts,10);
  assert.equal(payloads[0].key,frame.id);assert.equal(payloads[0].body.capture.mode,'scheduled');assert.equal(payloads[0].body.includeHistory,false);
});
test('in-flight submission is not duplicated and network failure stops without retry',async()=>{
  let reject,requests=0;const runner=new CameraAutoAnalyzer({request:()=>{requests++;return new Promise((_,r)=>reject=r);}});runner.resume();const first=runner.submit(frame);
  assert.equal(await runner.submit(frame),'busy');reject(new Error('offline'));assert.equal(await first,'failed');assert.equal(await runner.submit(frame),'disabled');assert.equal(requests,1);
});
test('stopping while checking prior job prevents a subsequent cloud submission',async()=>{
  let resolve,posts=0,clock=0;const runner=new CameraAutoAnalyzer({now:()=>clock,request:async(path,body)=>{if(body){posts++;return {id:'job'};}return new Promise(r=>resolve=r);}});runner.resume();await runner.submit(frame);clock=60000;
  const next=runner.submit(frame);runner.stop();resolve({status:'succeeded'});assert.equal(await next,'stopped');assert.equal(posts,1);
});
test('failed previous model task stops the next frame rather than silently charging again',async()=>{
  let clock=0,posts=0;const runner=new CameraAutoAnalyzer({now:()=>clock,request:async(path,body)=>body?{id:'job-'+(++posts)}:{status:'failed'}});runner.resume();await runner.submit(frame);clock=60000;
  assert.equal(await runner.submit(frame),'failed');assert.equal(posts,1);assert.equal(runner.enabled,false);
});
