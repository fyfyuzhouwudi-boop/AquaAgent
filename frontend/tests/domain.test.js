import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeed,reviewEvent,finishInspection} from '../src/domain.js';
import {createHttpApi} from '../src/api.js';

const input={eventId:'EV-0926',version:1,decision:'observe',reason:'已核对原始画面，继续观察。',operationId:'op-1'};
test('人工审核保存依据并改变事件状态，保留原始证据',()=>{
  const state=createSeed();const next=reviewEvent(state,input);
  assert.equal(next.events[0].status,'observing');assert.equal(next.events[0].version,2);
  assert.equal(next.events[0].reviews[0].reason,input.reason);
  assert.deepEqual(next.events[0].snapshot,state.events[0].snapshot);assert.equal(state.events[0].version,1);
});
test('版本冲突和空审核依据不能覆盖记录',()=>{
  assert.throws(()=>reviewEvent(createSeed(),{...input,version:9}),e=>e.code==='VERSION_CONFLICT');
  assert.throws(()=>reviewEvent(createSeed(),{...input,reason:' '}),e=>e.code==='VALIDATION');
});
test('同一审核幂等，不同请求体复用编号拒绝',()=>{
  const next=reviewEvent(createSeed(),input);assert.equal(reviewEvent(next,input).events[0].reviews.length,1);
  assert.throws(()=>reviewEvent(next,{...input,reason:'变更'}),e=>e.code==='IDEMPOTENCY_CONFLICT');
});
test('关闭事件不能继续被复核覆盖',()=>{
  const next=reviewEvent(createSeed(),{...input,decision:'false_positive'});
  assert.throws(()=>reviewEvent(next,{...input,version:2,operationId:'op-2'}),e=>e.code==='CLOSED');
});
function running(state,outcome){state.runs.unshift({id:'RUN-test',pointId:'pond-3',status:'running',outcome,createdAt:new Date().toISOString()});return state;}
test('新巡检合并近期未关闭事件，但不替换正在审核的原始截图',()=>{
  const state=running(createSeed(),'uncertain');const next=finishInspection(state,'RUN-test');
  assert.equal(next.events.length,state.events.length);assert.equal(next.events[0].additionalEvidence.length,1);
  assert.deepEqual(next.events[0].snapshot,state.events[0].snapshot);assert.equal(next.events[0].status,'pending_review');
});
test('巡检未发现异常不自动关闭既有事件',()=>{
  const state=running(createSeed(),'normal');const next=finishInspection(state,'RUN-test');
  assert.equal(next.runs[0].status,'succeeded');assert.equal(next.events[0].status,'pending_review');
});
test('云端失败不写入正常分析，也不创建病害事件',()=>{
  const state=running(createSeed(),'failure');const next=finishInspection(state,'RUN-test');
  assert.equal(next.runs[0].status,'failed');assert.deepEqual(next.events,state.events);assert.deepEqual(next.points,state.points);
});
test('取消任务不能被迟到结果改成成功',()=>{
  const state=running(createSeed(),'uncertain');state.runs[0].status='cancelled';assert.equal(finishInspection(state,'RUN-test'),state);
});
test('真实接口错误不静默回退成演示成功',async()=>{
  const http=createHttpApi('/api/v1',async()=>({ok:false,status:503,json:async()=>({code:'UNAVAILABLE',message:'服务未接入'})}));
  await assert.rejects(http.load(),e=>e.code==='UNAVAILABLE');
});
test('审核接口携带幂等标识及预期版本，未附带模型密钥',async()=>{
  let captured;const http=createHttpApi('/api/v1',async(url,options)=>{captured={url,options};return {ok:true,json:async()=>({ok:true})};});
  await http.review(input);assert.equal(captured.options.headers['Idempotency-Key'],'op-1');
  assert.equal(JSON.parse(captured.options.body).expected_version,1);assert.equal(captured.options.headers.Authorization,undefined);
});
