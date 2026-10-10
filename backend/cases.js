import {randomUUID,createHash} from 'node:crypto';
import {AppError} from './providers.js';
import {prepareReviewFiles,persistReviewFiles,readReviewFile} from './review-files.js';

const fail=(message,code='CONFLICT',status=409)=>{throw new AppError(message,code,status);};
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(`${label}须为 1 至 ${max} 字。`,'VALIDATION',400);return v.trim();};
const version=(actual,expected)=>{if(actual!==expected)fail('记录已更新，请刷新后重试。');};
const active=c=>{if(c.status==='closed')fail('病例已结案，请先重新观察。');};
const date=v=>{if(v===null||v===''||v===undefined)return null;if(typeof v!=='string'||v.length>40||!Number.isFinite(Date.parse(v)))fail('复查时间无效。','VALIDATION',400);return new Date(v).toISOString();};
function reviewedJob(store,id,expected){
  const j=store.data.jobs.find(j=>j.id===id);if(!j)fail('任务不存在。','NOT_FOUND',404);
  version(j.version,expected);if(j.status!=='succeeded'||!j.review)fail('请先完成任务的人工核对。');return j;
}
function transaction(store,work){
  const cases=structuredClone(store.data.cases),audit=store.data.audit.slice(),jobState=store.data.jobs.map(j=>({job:j,caseId:j.caseId,version:j.version}));
  try{return work();}catch(e){store.data.cases=cases;store.data.audit=audit;for(const s of jobState){s.job.version=s.version;if(s.caseId===undefined)delete s.job.caseId;else s.job.caseId=s.caseId;}throw e;}
}
export function caseSummary(c){return {id:c.id,title:c.title,scope:c.scope,status:c.status,version:c.version,createdAt:c.createdAt,updatedAt:c.updatedAt,nextReviewAt:c.nextReviewAt,taskCount:c.links.length,followupCount:c.entries.filter(e=>e.kind==='followup').length};}
export function getCase(store,id){const c=store.data.cases.find(c=>c.id===id);if(!c)fail('病例不存在。','NOT_FOUND',404);return c;}
export function caseDetails(store,id){
  const c=getCase(store,id);return {...c,creationOperation:undefined,creationFingerprint:undefined,links:c.links.map(({operationId,fingerprint,...link})=>link),entries:c.entries.map(({operationId,fingerprint,...e})=>e),jobs:c.links.map(link=>{
    const j=store.data.jobs.find(j=>j.id===link.jobId);if(!j)return {id:link.jobId,missing:true};
    return {id:j.id,prompt:j.prompt,scope:j.scope,createdAt:j.createdAt,status:j.status,result:j.result,hasImage:!!j.image,review:j.review,reviewHistory:j.reviewHistory||[],sources:j.sources||[]};
  })};
}
export function mutateCase(store,action,id,input,operationId,directory){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('请求内容无效。','VALIDATION',400);
  if(typeof operationId!=='string'||! /^[a-zA-Z0-9-]{8,80}$/.test(operationId))fail('缺少有效操作编号。','VALIDATION',400);
  const fingerprint=createHash('sha256').update(JSON.stringify({action,id,input})).digest('hex');
  const previous=store.data.cases.find(c=>c.creationOperation===operationId);
  const existing=store.data.cases.flatMap(c=>[...c.entries,...c.links].map(e=>({caseId:c.id,...e}))).find(e=>e.operationId===operationId);
  if(previous||existing){if((previous?.creationFingerprint||existing.fingerprint)!==fingerprint)fail('操作编号已用于不同请求。');return {id:previous?.id||existing.caseId};}
  if(action==='create'){
    if(store.data.cases.length>=200)fail('已保存 200 个病例，请先备份归档。');
    const job=reviewedJob(store,input.jobId,input.jobVersion);if(job.caseId)fail('任务已关联病例，请查看已有档案。');
    const title=text(input.title,100,'病例名称'),nextReviewAt=date(input.nextReviewAt),at=new Date().toISOString();
    return transaction(store,()=>{
      const c={id:randomUUID(),title,scope:job.scope,status:'observing',version:1,createdAt:at,updatedAt:at,nextReviewAt,creationOperation:operationId,creationFingerprint:fingerprint,links:[{jobId:job.id,at,reviewVersion:job.version,review:structuredClone(job.review)}],entries:[]};
      store.data.cases.unshift(c);job.caseId=c.id;job.version++;store.audit('case_created',c.id,`from=${job.id}`);return {id:c.id};
    });
  }
  const c=getCase(store,id);
  if(action==='link'&&c.links.some(l=>l.jobId===input.jobId))return {id:c.id};
  version(c.version,input.version);
  if(action==='link'){
    active(c);const job=reviewedJob(store,input.jobId,input.jobVersion);if(job.caseId)fail('任务已关联其他病例。');if(job.scope!==c.scope)fail('观察对象不一致，不能关联到该病例。');
    return transaction(store,()=>{const at=new Date().toISOString();c.links.push({jobId:job.id,at,reviewVersion:job.version,review:structuredClone(job.review),operationId,fingerprint});c.updatedAt=at;c.version++;job.caseId=c.id;job.version++;store.audit('case_task_linked',id,job.id);return {id};});
  }
  if(!['followup','close','reopen'].includes(action))fail('未知病例操作。','NOT_FOUND',404);
  if(action==='reopen'){if(c.status!=='closed')fail('病例已经处于观察中。');}else active(c);
  if(c.entries.length>=300)fail('病例记录已达到上限，请备份归档。');
  const note=text(input.note,3000,action==='followup'?'复查记录':'操作依据');
  const nextReviewAt=action==='close'?null:date(input.nextReviewAt);
  const observedAt=action==='followup'?(date(input.observedAt)||new Date().toISOString()):null;
  if(observedAt&&Date.parse(observedAt)>Date.now()+60000)fail('复查记录时间不能晚于当前时间。','VALIDATION',400);
  const prepared=action==='followup'?prepareReviewFiles({attachments:input.attachments??[],retainedAttachmentIds:[]},{reviewHistory:c.entries}):{pending:[]};
  const rollback=persistReviewFiles(directory,prepared.pending);
  try{return transaction(store,()=>{
    const at=new Date().toISOString();c.entries.push({id:randomUUID(),kind:action,at,observedAt,note,attachments:prepared.pending.map(p=>p.meta),operationId,fingerprint,operator:'local-operator'});
    c.nextReviewAt=nextReviewAt;c.status=action==='close'?'closed':'observing';c.updatedAt=at;c.version++;
    if(action==='close')c.closedAt=at;else delete c.closedAt;
    store.audit(`case_${action}`,id,note.slice(0,100));return {id};
  });}catch(e){rollback();throw e;}
}
export function readCaseFile(directory,c,id){return readReviewFile(directory,{reviewHistory:c.entries},id);}
