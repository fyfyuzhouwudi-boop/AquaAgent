import {AppError} from './providers.js';

export function eventState(job){
  if(job.resolution?.status==='closed')return 'closed';
  if(['queued','running'].includes(job.status))return 'analyzing';
  if(job.status==='failed')return 'failed';
  if(job.status==='cancelled')return 'cancelled';
  if(job.review?.decision==='needs_evidence')return 'needs_evidence';
  if(job.review)return 'ready_to_close';
  if(job.type==='inspection'||job.reviewStatus==='pending')return 'pending_review';
  return 'not_required';
}
export function eventFields(job){
  const state=eventState(job);
  return {eventState:state,eventNeedsAttention:['failed','cancelled','needs_evidence','ready_to_close','pending_review'].includes(state)};
}
export function resolveEvent(store,job,input){
  if(!input||!['close','reopen'].includes(input.action)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw new AppError('请选择操作并填写 1 至 1000 字的处理依据。');
  if(input.version!==job.version)throw new AppError('记录已更新，请刷新后重试。','CONFLICT',409);
  const state=eventState(job);
  if(input.action==='close'&&!['ready_to_close','failed','cancelled'].includes(state))throw new AppError('请先完成分析和人工核对；待补充证据的事件不能直接完成。','CONFLICT',409);
  if(input.action==='reopen'&&state!=='closed')throw new AppError('只有已结束的事件可以重新打开。','CONFLICT',409);
  const previous={resolution:job.resolution,resolutionHistory:job.resolutionHistory,version:job.version},audit=store.data.audit.slice();
  try{
    const resolution={status:input.action==='close'?'closed':'open',at:new Date().toISOString(),reason:input.reason.trim(),operator:'local-operator',outcome:input.action==='close'?(job.status==='succeeded'?'reviewed':'incomplete'):null};
    job.resolution=resolution;job.resolutionHistory=[...(job.resolutionHistory||[]),resolution];job.version++;
    store.audit(input.action==='close'?'event_closed':'event_reopened',job.id,resolution.reason);
    return {ok:true,...eventFields(job)};
  }catch(error){Object.assign(job,previous);store.data.audit=audit;throw error;}
}
