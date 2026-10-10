import { createSeed, reviewEvent, finishInspection, DomainError } from './domain.js';

// Keep public synthetic demo state separate from the original installation.
const KEY = 'fool-fish-public-demo-v1';
const listeners = new Set();
let memory = null;
let warning = '';
const timers = new Map();
const uid = () => globalThis.crypto.randomUUID();

function read() {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.schemaVersion !== 1 || !['points','events','plans','runs','cases','audit'].every(k => Array.isArray(parsed[k])) || !parsed.operations) throw new Error('invalid schema');
      memory = parsed;
      // 浏览器关闭意味着演示执行中断，不能恢复成虚假的成功。
      memory.runs = memory.runs.map(r => ['running','queued'].includes(r.status) ? {...r, status:'failed', error:'演示页面已关闭，任务未完成。可重新执行。'} : r);
      return memory;
    }
  } catch {
    warning = '原演示记录暂时无法读取，已保留原数据。本次改用临时演示状态。';
  }
  memory = createSeed();
  return memory;
}
function save(state) {
  memory = state;
  if (!warning) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { warning = '浏览器存储空间不足，本次更改仅保留到页面关闭。请导出记录。'; }
  }
  for (const listener of listeners) listener();
}
function loadFreshForWrite() {
  if (warning) return read();
  const raw = localStorage.getItem(KEY);
  if (raw) {
    let parsed;
    try { parsed=JSON.parse(raw); } catch { throw new DomainError('本地记录无法读取，停止写入以保护原记录。', 'STORAGE'); }
    if (parsed.schemaVersion!==1 || !Array.isArray(parsed.events)) throw new DomainError('本地记录格式不兼容。', 'STORAGE');
    memory=parsed;
  }
  return read();
}
if (typeof window !== 'undefined') window.addEventListener('storage', e => {
  if (e.key === KEY) { memory=null; for (const listener of listeners) listener(); }
});

export const demoApi = {
  mode: 'demo',
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  async load() { return {...structuredClone(read()), warning}; },
  async review(input) { save(reviewEvent(loadFreshForWrite(), input)); },
  async updatePlan(id, patch) {
    const state=structuredClone(loadFreshForWrite());
    const plan=state.plans.find(p=>p.id===id);
    if (!plan) throw new DomainError('巡检计划不存在。','NOT_FOUND');
    if (!Number.isInteger(patch.interval) || patch.interval<10 || patch.interval>86400) throw new DomainError('巡检间隔应为 10 至 86400 秒的整数。','VALIDATION');
    plan.interval=patch.interval; plan.enabled=!!patch.enabled; plan.version++;
    plan.nextRunAt=new Date(Date.now()+patch.interval*1000).toISOString();
    state.audit.unshift({id:uid(),at:new Date().toISOString(),action:'修改巡检计划',target:id,detail:`间隔 ${patch.interval} 秒，${patch.enabled?'启用':'暂停'}`});
    save(state);
  },
  async inspect(pointId, outcome='uncertain', snapshotUrl=null, attempt=1) {
    const state=structuredClone(loadFreshForWrite());
    const point=state.points.find(p=>p.id===pointId);
    if (!point || point.deviceStatus==='offline') throw new DomainError('该监控点离线，无法开始巡检。','OFFLINE');
    if (!['normal','uncertain','failure'].includes(outcome)) throw new DomainError('无效的演示场景。','VALIDATION');
    if (state.runs.filter(r=>r.status==='running').length>=2 || state.runs.some(r=>r.pointId===pointId&&r.status==='running')) throw new DomainError('已有任务执行中，请等待完成。','BUSY');
    const id=`RUN-${uid().slice(0,8)}`;
    state.runs.unshift({id,pointId,status:'running',outcome,createdAt:new Date().toISOString(),steps:['running','queued','queued','queued'],attempt,snapshotUrl});
    const plan=state.plans.find(p=>p.pointId===pointId);
    plan.nextRunAt=new Date(Date.now()+plan.interval*1000).toISOString();
    save(state);
    const timer=setTimeout(()=>{
      const step=structuredClone(loadFreshForWrite()); const run=step.runs.find(r=>r.id===id);
      if (run?.status==='running') {run.steps=['succeeded','running','queued','queued'];save(step);}
      timers.set(id,setTimeout(()=>{save(finishInspection(loadFreshForWrite(),id));timers.delete(id);},1600));
    },1200);
    timers.set(id,timer);
    return {id};
  },
  async retry(id) {
    const run=read().runs.find(r=>r.id===id);
    if (!run || run.status!=='failed') throw new DomainError('只可重试失败任务。','VALIDATION');
    if (run.attempt>=3) throw new DomainError('已达到 3 次尝试上限，请检查服务后重新发起。','RETRY_LIMIT');
    return this.inspect(run.pointId, 'uncertain', null, run.attempt+1);
  },
  async cancel(id) {
    const state=structuredClone(loadFreshForWrite());const run=state.runs.find(r=>r.id===id);
    if (!run || run.status!=='running') throw new DomainError('任务已结束，无需取消。','VALIDATION');
    clearTimeout(timers.get(id));timers.delete(id);run.status='cancelled';run.completedAt=new Date().toISOString();save(state);
  },
  async createCase(eventId) {
    const state=structuredClone(loadFreshForWrite());const event=state.events.find(e=>e.id===eventId);
    if (!event || !event.reviews.some(r=>['confirmed','observe'].includes(r.decision))) throw new DomainError('请先确认异常或决定继续观察，再建立病例。','VALIDATION');
    if (event.caseId) return {id:event.caseId};
    const id=`CASE-${uid().slice(0,6)}`;event.caseId=id;event.version++;
    state.cases.unshift({id,pointId:event.pointId,eventIds:[eventId],title:event.title,status:'observing',createdAt:new Date().toISOString(),followups:[]});save(state);return {id};
  },
  async followup(caseId, {at,note}) {
    if (!note.trim()||!Number.isFinite(Date.parse(at))||Date.parse(at)<=Date.now()) throw new DomainError('请填写未来的复查时间和复查内容。','VALIDATION');
    const state=structuredClone(loadFreshForWrite());const c=state.cases.find(c=>c.id===caseId);
    if(!c)throw new DomainError('病例不存在。','NOT_FOUND');
    c.followups.push({id:uid(),at:new Date(at).toISOString(),note:note.trim(),status:'scheduled'});save(state);
  },
};

/** HTTP adapter contract. No secret belongs in this browser module. */
export function createHttpApi(base='/api/v1', fetcher=globalThis.fetch) {
  async function request(path, {method='GET',body,operationId,signal}={}) {
    const timeout=AbortSignal.timeout(15000);
    const response=await fetcher(`${base.replace(/\/$/,'')}${path}`, {
      method, credentials:'same-origin', signal:signal?AbortSignal.any([signal,timeout]):timeout,
      headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(operationId?{'Idempotency-Key':operationId}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw new DomainError(data?.message||`服务请求失败（${response.status}）`,data?.code||String(response.status));
    return data;
  }
  return {
    mode:'api', subscribe(){return()=>{};}, request,
    // 页面聚合端点为新增联调契约，详见 开发交接/前端实现交接.md。
    load:()=>request('/dashboard'),
    inspect:(monitorPointId)=>request('/inspection-runs',{method:'POST',body:{monitor_point_id:monitorPointId},operationId:uid()}),
    review:input=>request(`/events/${encodeURIComponent(input.eventId)}/reviews`,{method:'POST',body:{expected_version:input.version,decision:input.decision,reason:input.reason},operationId:input.operationId}),
    updatePlan:(id,p)=>request(`/inspection-plans/${encodeURIComponent(id)}`,{method:'PATCH',body:{interval_seconds:p.interval,enabled:p.enabled},operationId:uid()}),
    retry:id=>request(`/inspection-runs/${encodeURIComponent(id)}/retry`,{method:'POST',body:{},operationId:uid()}),
    cancel:id=>request(`/inspection-runs/${encodeURIComponent(id)}/cancel`,{method:'POST',body:{},operationId:uid()}),
    createCase:eventId=>request('/cases',{method:'POST',body:{event_id:eventId},operationId:uid()}),
    followup:(id,p)=>request(`/cases/${encodeURIComponent(id)}/followups`,{method:'POST',body:{scheduled_at:new Date(p.at).toISOString(),note:p.note},operationId:uid()}),
  };
}
export const api = import.meta.env?.VITE_DATA_MODE==='api' ? createHttpApi(import.meta.env.VITE_API_BASE) : demoApi;
