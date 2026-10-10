// A read-only projection of persisted camera jobs. The original image is served only
// by the authenticated image endpoint, never embedded in the audit list payload.
import {eventFields} from './event-lifecycle.js';
export function cameraAudit(jobs,audit=[],limit=200){
  const selected=jobs.filter(job=>job.capture?.kind==='camera').slice(0,Math.min(Math.max(Number(limit)||200,1),200));
  return selected.map(job=>({
    id:job.id,scope:job.scope,capture:job.capture,status:job.status,version:job.version,caseId:job.caseId,...eventFields(job),resolution:job.resolution||null,resolutionHistory:job.resolutionHistory||[],
    createdAt:job.createdAt,completedAt:job.completedAt||null,
    reviewStatus:job.reviewStatus||null,review:job.review||null,reviewHistory:job.reviewHistory||[],error:job.error||null,
    events:audit.filter(entry=>entry.target===job.id).map(({at,actor,action,detail})=>({at,actor,action,detail})),
    imageUrl:`/api/agents/jobs/${job.id}/image`,
    observation:job.steps?.find(step=>step.id==='vision')?.output||null,
    finalAdvice:job.finalAdvice?job.result:null,adviceBasis:job.adviceBasis||null,
    assessment:job.steps?.find(step=>step.id==='coordinator')?.output||null,
    steps:(job.steps||[]).map(({id,name,provider,model,status,startedAt,completedAt,tools,calls})=>({id,name,provider,model,status,startedAt,completedAt,tools,calls})),
    retrievals:(job.retrievals||[]).map(({query,reason,status,sourceIds,error})=>({query,reason,status,sourceIds,error})),
    sources:(job.sources||[]).map(({id,title,source,page})=>({id,title,source,page})),
  }));
}
