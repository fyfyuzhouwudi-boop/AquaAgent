import test from 'node:test';
import assert from 'node:assert/strict';
import {agentProgress} from '../src/agent-progress.js';
const job={status:'running',type:'inspection',steps:[{id:'vision',status:'succeeded',output:'体表可见白色附着物'},{id:'coordinator',status:'running'},{id:'evidence',status:'skipped'},{id:'followup',status:'skipped'}],sources:[],retrievals:[]};
test('future work is pending rather than incorrectly marked unused',()=>{const cards=agentProgress(job);assert.equal(cards[0].detail,'体表可见白色附着物');assert.equal(cards[2].label,'按需调用');assert.equal(cards[3].label,'待执行');});
test('retrieval waiting and completed retrieval show actual progress',()=>{const current={...job,steps:job.steps.map(s=>s.id==='evidence'?{...s,status:'running'}:s),retrievals:[{query:'体表白色附着物'}]};assert.equal(agentProgress(current)[1].detail,'等待资料检索返回');assert.match(agentProgress(current)[2].detail,/体表白色附着物/);current.steps[2].status='succeeded';current.sources=[{id:'R1'}];assert.equal(agentProgress(current)[2].detail,'检索 1 次，返回 1 条资料');});
test('failed coordinator preserves completed vision and distinguishes unexecuted followup',()=>{const failed={...job,status:'failed',error:'连接中断',steps:job.steps.map(s=>s.id==='coordinator'?{...s,status:'failed'}:s)};const cards=agentProgress(failed);assert.equal(cards[0].label,'已完成');assert.equal(cards[1].detail,'连接中断');assert.equal(cards[3].label,'未执行');});
