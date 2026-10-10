import test from 'node:test';
import assert from 'node:assert/strict';
import {runJob,ROLES} from '../agents.js';

const config={qwen:{id:'qwen',model:'test'},deepseek:{id:'deepseek',model:'test'}};
function fixture(type='question'){
  const job={id:'general-test',type,prompt:'解释电脑内存和硬盘的区别',scope:'日常问答',status:'queued',includeHistory:false,steps:ROLES.map(r=>({...r,status:'queued'}))};
  const store={data:{jobs:[job]},save(){},audit(){}};
  return {job,store,config,signal:new AbortController().signal};
}
test('general question uses Qwen only and finishes without disease review or unrelated history',async()=>{
  const f=fixture(),requests=[];
  f.store.data.jobs.push({id:'old-fish',scope:'鱼缸01',status:'succeeded',prompt:'鱼体异常',result:'旧病例'});
  await runJob(f.job,{...f,call:async(provider,messages)=>{requests.push({provider,messages});return{text:'内存用于临时运行数据，硬盘用于长期存储。'};},retrieve:async()=>{assert.fail('Direct daily answer must not run fish retrieval');}});
  assert.equal(requests.length,1);assert.equal(requests[0].provider.id,'qwen');
  assert.match(requests[0].messages[0].content,/通用问答助手/);
  assert.match(requests[0].messages[0].content,/没有联网搜索/);
  const context=JSON.parse(requests[0].messages[1].content);
  assert.equal(context.question,f.job.prompt);assert.deepEqual(context.history,[]);
  assert.equal(f.job.status,'succeeded');assert.equal(f.job.reviewStatus,'not_required');
  assert.equal(f.job.steps.find(s=>s.id==='vision').status,'skipped');
  assert.equal(f.job.steps.find(s=>s.id==='followup').status,'skipped');
});
test('image inspection retains fish observation constraints and human review',async()=>{
  const f=fixture('inspection');f.job.image='fixture-image';const prompts=[];
  await runJob(f.job,{...f,call:async(provider,messages)=>{prompts.push(messages[0].content);return{text:prompts.length===1?JSON.stringify({fishVisible:true,quality:'unusable',features:[],description:'图片细节不足',limitations:'无法辨认体表'}):'图片细节不足，需要人工核对。'};}});
  assert.equal(prompts.length,3);
  assert.ok(prompts.every(p=>!p.includes('通用问答助手')));
  assert.match(prompts[0],/不猜测疾病/);assert.match(prompts[1],/只用于鱼类养殖资料/);
  assert.equal(f.job.status,'succeeded');assert.equal(f.job.reviewStatus,'pending');
});
