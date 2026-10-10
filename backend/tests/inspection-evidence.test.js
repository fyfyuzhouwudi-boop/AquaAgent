import test from 'node:test';
import assert from 'node:assert/strict';
import {runJob,ROLES} from '../agents.js';
import {parseVision,featureQuery} from '../inspection-evidence.js';
import {AppError} from '../providers.js';
import {cameraAudit} from '../camera-audit.js';

const vision={fishVisible:true,quality:'limited',features:['体表散在白色点状附着物','尾鳍局部破损'],description:'可见两个外观特征',limitations:'鳃部不可见'};
const config={qwen:{id:'qwen',model:'test',key:'private-qwen-key'},deepseek:{id:'deepseek',model:'test',key:'private-deepseek-key'},rag:{key:'private-rag-key'}};
function fixture(){
  const job={id:'fixture',type:'inspection',scope:'tank',prompt:'判断并给建议',image:'private-original-image',includeHistory:false,steps:ROLES.map(r=>({...r,status:'queued'})),capture:{kind:'camera'}};
  const store={data:{jobs:[job]},save(){},audit(){}};
  return {job,store,config,signal:new AbortController().signal};
}
const noToolsCall=(v=vision,advice='当前只能暂定判断。先检查并补拍。')=>async(p,m)=>({text:p.id==='deepseek'?advice:Array.isArray(m[1].content)?JSON.stringify(v):'主分析建议核对。'});

test('all recognised features are searched before reasoning; final advisor receives sources and permitted history, not raw image',async()=>{
  const f=fixture(),order=[];f.job.includeHistory=true;
  f.store.data.jobs.push({id:'old',scope:'tank',status:'succeeded',prompt:'旧观察',result:'旧模型结论',review:{decision:'rejected',reason:'人工纠正旧结论'}});
  await runJob(f.job,{...f,retrieve:async(c,q)=>{order.push('rag');for(const feature of vision.features)assert.ok(q.includes(feature));assert.ok(!q.includes('tank'));return[{text:'本次真实资料原文',title:'资料',page:2}];},call:async(p,m)=>{
    order.push(p.id);
    if(Array.isArray(m[1].content))return{text:JSON.stringify(vision)};
    const context=JSON.parse(m[1].content);assert.equal(context.sources[0].text,'本次真实资料原文');
    if(p.id==='deepseek'){
      assert.equal(context.vision.quality,'limited');assert.equal(context.history[0].review.decision,'rejected');
      assert.ok(!JSON.stringify(m).includes('private-original-image'));
      return{text:'结合可见特征及资料 [R1]，仍需核对。处理：补拍并检查现场。'};
    }
    return{text:'资料 [R1] 有相关描述但不足以确诊。'};
  }});
  assert.deepEqual(order,['qwen','rag','qwen','deepseek']);assert.equal(f.job.status,'succeeded');
  assert.equal(f.job.adviceBasis,'retrieved');assert.equal(f.job.reviewStatus,'pending');
  assert.equal(f.job.result,f.job.finalAdvice);assert.equal(cameraAudit([f.job])[0].finalAdvice,f.job.result);
});
test('empty search still generates a provisional answer and records empty separately',async()=>{
  const f=fixture();await runJob(f.job,{...f,call:async(p,m)=>{if(p.id==='deepseek'){assert.match(m[0].content,/连接正常、检索成功/);assert.equal(JSON.parse(m[1].content).retrievalStatus,'empty');}return noToolsCall()(p,m);},retrieve:async()=>[]});
  assert.equal(f.job.status,'succeeded');assert.equal(f.job.adviceBasis,'empty');assert.equal(f.job.retrievals[0].status,'empty');
  assert.match(f.job.result,/未检索到资料/);assert.ok(f.job.finalAdvice);assert.equal(f.job.reviewStatus,'pending');
});
test('mandatory search shares the two-search budget and additional sources reach final advisor',async()=>{
  const f=fixture();let count=0,coordinatorCalls=0;
  await runJob(f.job,{...f,retrieve:async()=>{count++;return[{title:'资料',text:'片段'+count}];},call:async(p,m)=>{
    if(Array.isArray(m[1].content))return{text:JSON.stringify(vision)};
    if(p.id==='deepseek'){const c=JSON.parse(m[1].content);assert.deepEqual(c.sources.map(s=>s.id),['R1','R2']);return{text:'综合依据 [R1] [R2] 给出待核实建议。'};}
    coordinatorCalls++;
    return coordinatorCalls===1?{text:'',toolCalls:[{id:'extra',type:'function',function:{name:'search_fish_knowledge',arguments:JSON.stringify({query:'尾鳍破损的鉴别特征',reason:'补充区别依据'})}}]}:{text:'两次资料仍需核对 [R2]'};
  }});
  assert.equal(count,2);assert.equal(f.job.retrievals.length,2);assert.equal(f.job.status,'succeeded');
});
test('RAG failure is disclosed and permits provisional advice without silently retrying',async()=>{
  const f=fixture();let retrieves=0;
  await runJob(f.job,{...f,call:async(p,m,options)=>{if(p.id==='qwen'&&!Array.isArray(m[1].content))assert.equal(options.toolChoice,'none');return noToolsCall()(p,m);},retrieve:async()=>{retrieves++;throw new AppError('连接失败','RAG_CONNECTION',502);}});
  assert.equal(retrieves,1);assert.equal(f.job.status,'succeeded');assert.equal(f.job.adviceBasis,'unavailable');
  assert.equal(f.job.retrievals[0].status,'failed');assert.equal(f.job.steps.find(s=>s.id==='evidence').status,'failed');
  assert.match(f.job.result,/资料库暂不可用/);assert.ok(!f.job.result.includes('本次未检索到资料'));
});
test('no fish cannot populate disease features or force feature search',async()=>{
  const v={...vision,fishVisible:false,quality:'unusable'},f=fixture();
  assert.equal(featureQuery(parseVision(JSON.stringify(v))),null);
  await runJob(f.job,{...f,call:noToolsCall(v,'画面没有鱼。请重新拍摄鱼体。'),retrieve:async()=>{assert.fail('No fish must not force a lookup');}});
  assert.equal(f.job.status,'succeeded');assert.deepEqual(f.job.vision.features,[]);assert.equal(f.job.adviceBasis,'no_features');
  assert.match(f.job.result,/不能据此判定病害/);
});
test('malformed vision and credential-bearing features never reach retrieval',async()=>{
  assert.throws(()=>parseVision('not json'),e=>e.code==='VISION_FORMAT');
  assert.throws(()=>parseVision(JSON.stringify({...vision,quality:'anything'})),e=>e.code==='VISION_FORMAT');
  const f=fixture();await runJob(f.job,{...f,call:noToolsCall({...vision,features:['private-qwen-key']}),retrieve:async()=>assert.fail('Credentials must not reach RAG')});
  assert.equal(f.job.status,'failed');assert.equal(f.job.finalAdvice,undefined);
});
test('fabricated DeepSeek citations fail rather than become final advice',async()=>{
  const f=fixture();await runJob(f.job,{...f,call:noToolsCall(vision,'确定结论 [R9]'),retrieve:async()=>[]});
  assert.equal(f.job.status,'failed');assert.equal(f.job.result,undefined);assert.equal(f.job.finalAdvice,undefined);
});
test('cancellation during mandatory retrieval cannot be converted to provisional success',async()=>{
  const f=fixture(),controller=new AbortController();
  await runJob(f.job,{...f,signal:controller.signal,call:noToolsCall(),retrieve:async()=>{controller.abort();f.job.status='cancelled';throw new AppError('取消','RAG_CONNECTION');}});
  assert.equal(f.job.status,'cancelled');assert.equal(f.job.finalAdvice,undefined);
  assert.equal(f.job.steps.find(s=>s.id==='followup').calls,undefined);
});
