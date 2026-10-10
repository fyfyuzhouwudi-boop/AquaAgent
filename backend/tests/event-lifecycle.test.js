import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request} from 'node:http';
import {Store} from '../store.js';
import {createApp} from '../server.js';
import {eventFields,resolveEvent} from '../event-lifecycle.js';
import {cameraAudit} from '../camera-audit.js';

const makeJob=()=>({id:'11111111-1111-4111-8111-111111111111',type:'inspection',status:'succeeded',version:1,reviewStatus:'pending',steps:[],capture:{kind:'camera',mode:'manual'},image:'original-image',caseId:'case-1'});
const fakeStore=()=>({data:{audit:[],cases:[{id:'case-1',status:'observing'}]},audit(action,target,detail){this.data.audit.unshift({action,target,detail});}});
const act=(s,j,action='close',reason='已经人工处理')=>resolveEvent(s,j,{action,reason,version:j.version});

test('pending and needs-evidence remain actionable and cannot be completed',()=>{
  const s=fakeStore(),j=makeJob();
  assert.equal(eventFields(j).eventState,'pending_review');
  assert.throws(()=>act(s,j),e=>e.status===409);
  j.review={decision:'needs_evidence',reason:'需要近照'};j.reviewStatus='reviewed';
  assert.deepEqual(eventFields(j),{eventState:'needs_evidence',eventNeedsAttention:true});
  assert.equal(cameraAudit([j])[0].eventNeedsAttention,true);
  assert.throws(()=>act(s,j),e=>e.status===409);
  assert.equal(j.version,1);assert.equal(s.data.audit.length,0);
});
test('review then completion removes attention; reopen restores it without losing evidence or closing case',()=>{
  const s=fakeStore(),j=makeJob();j.review={decision:'accepted',attachments:[{id:'file-1'}]};
  assert.equal(eventFields(j).eventState,'ready_to_close');
  act(s,j);assert.equal(j.version,2);assert.equal(eventFields(j).eventNeedsAttention,false);
  assert.equal(cameraAudit([j])[0].eventState,'closed');assert.equal(j.status,'succeeded');
  assert.equal(j.image,'original-image');assert.equal(j.review.attachments[0].id,'file-1');
  assert.equal(s.data.cases[0].status,'observing');
  act(s,j,'reopen','补充证据需要更正');assert.equal(eventFields(j).eventState,'ready_to_close');
  assert.equal(j.resolutionHistory.length,2);assert.equal(s.data.audit[0].action,'event_reopened');
});
test('failed and cancelled may be ended with explanation but retain unsuccessful execution outcome',()=>{
  for(const status of ['failed','cancelled']){
    const s=fakeStore(),j={...makeJob(),status};act(s,j);
    assert.equal(j.status,status);assert.equal(j.resolution.outcome,'incomplete');
    assert.equal(eventFields(j).eventNeedsAttention,false);act(s,j,'reopen');
    assert.equal(eventFields(j).eventState,status);assert.equal(eventFields(j).eventNeedsAttention,true);
  }
});
test('active tasks, blank reasons, stale versions and repeated close are rejected',()=>{
  const s=fakeStore(),j={...makeJob(),review:{decision:'rejected'}};
  assert.throws(()=>act(s,j,'close',' '));
  assert.throws(()=>resolveEvent(s,j,{action:'close',reason:'理由',version:0}),e=>e.status===409);
  assert.throws(()=>act(s,{...j,status:'running'}),e=>e.status===409);
  act(s,j);assert.throws(()=>act(s,j),e=>e.status===409);
  assert.equal(j.resolutionHistory.length,1);
});
test('failed persistence rolls back lifecycle version and audit',()=>{
  const s=fakeStore(),j={...makeJob(),status:'failed'};s.audit=function(action){this.data.audit.unshift({action});throw new Error('disk full');};
  assert.throws(()=>act(s,j),/disk full/);assert.equal(j.resolution,undefined);assert.equal(j.version,1);assert.equal(s.data.audit.length,0);
});
function http(url,options={}){return new Promise((resolve,reject)=>{const req=request(url,{method:options.method||'GET',headers:options.headers},res=>{const parts=[];res.on('data',p=>parts.push(p));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(parts).toString())}));});req.on('error',reject);req.end(options.body);});}
test('HTTP closure requires session and CSRF, blocks review until reopen, and survives reload',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'fish-events-')),file=path.join(dir,'state.json'),configFile=path.join(dir,'.env');writeFileSync(configFile,'');
  const store=new Store(file),j={...makeJob(),review:{decision:'accepted',attachments:[]},reviewStatus:'reviewed'};store.data.jobs.push(j);store.save();
  const app=createApp({store,configFile,configEnv:{},call:async()=>{throw new Error('No model call allowed');}});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});});
  const root=`http://127.0.0.1:${app.address().port}/api/agents`,headers={Host:'127.0.0.1:8000'},url=root+'/jobs/'+j.id;
  assert.equal((await http(url+'/resolve',{method:'POST',headers,body:'{}'})).status,401);
  const session=await http(root+'/session',{headers});const h={...headers,Cookie:session.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':session.body.csrf,'Content-Type':'application/json'};
  const post=(suffix,payload,head=h)=>http(url+suffix,{method:'POST',headers:head,body:JSON.stringify(payload)});
  const payload={action:'close',reason:'误报已核实',version:1};
  assert.equal((await post('/resolve',payload,{...h,'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await post('/resolve',payload)).status,200);
  assert.equal((await http(root+'/camera/audit',{headers:h})).body.records[0].eventNeedsAttention,false);
  assert.equal((await post('/review',{version:2,decision:'needs_evidence',reason:'补拍'})).status,409);
  assert.equal(new Store(file).data.jobs[0].resolution.status,'closed');
  assert.equal((await post('/resolve',{action:'reopen',reason:'收到新照片',version:2})).status,200);
  assert.equal((await post('/review',{version:3,decision:'needs_evidence',reason:'补拍'})).status,200);
  assert.equal((await http(url,{headers:h})).body.eventState,'needs_evidence');
  assert.equal((await post('/resolve',{...payload,version:4})).status,409);
});
