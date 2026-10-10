import React,{useState} from 'react';
import {agentRequest} from './agent-api.js';

export const EVENT_LABELS={analyzing:'分析中',pending_review:'待人工核对',needs_evidence:'待补充证据',ready_to_close:'已核对 待结束',failed:'分析失败 待处理',cancelled:'已取消 待处理',closed:'事件已结束',not_required:'无需核对'};

export default function EventCompletion({job,onChanged}){
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const closed=job.eventState==='closed';
  const allowed=closed||['ready_to_close','failed','cancelled'].includes(job.eventState);
  if(!job.eventState||job.eventState==='not_required')return null;
  async function submit(event){
    event.preventDefault();setBusy(true);setError('');
    try{await agentRequest(`/jobs/${job.id}/resolve`,{action:closed?'reopen':'close',version:job.version,reason});setReason('');window.dispatchEvent(new Event('fish-event-updated'));await onChanged?.();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="event-completion">
    <h3>事件处理 · {EVENT_LABELS[job.eventState]}</h3>
    {job.resolution&&<p>{closed?'结束依据':'重新打开依据'}：{job.resolution.reason}<small> · {new Date(job.resolution.at).toLocaleString('zh-CN',{hour12:false})}</small></p>}
    {job.resolutionHistory?.length>1&&<details><summary>处理历史 · {job.resolutionHistory.length} 条</summary><ol>{job.resolutionHistory.map((entry,index)=><li key={index}>{new Date(entry.at).toLocaleString('zh-CN',{hour12:false})} · {entry.status==='closed'?'结束':'重新打开'}：{entry.reason}</li>)}</ol></details>}
    <p className="muted">{job.eventState==='needs_evidence'?'补充图片或检查信息后，重新保存人工核对结论；当前仍保留待办。':job.eventState==='pending_review'?'先在人工核对中保存结论，再结束本次事件。':job.eventState==='analyzing'?'模型仍在执行，暂不能结束事件。':closed?'本次处理已结束，原图、分析和核对记录保留。需要更正时可重新打开。':job.status==='succeeded'?'结束表示本次事件已经处理，不表示鱼体已康复，也不会自动结案。':'可以记录故障或放弃处理的原因并结束本次事件；原任务仍保持失败或取消状态。'}</p>
    {allowed&&<form onSubmit={submit}><label>{closed?'重新打开原因':'本次处理结果'}<textarea rows={2} required maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder={closed?'例如发现新证据，需要重新核对':'例如已核实误报，或已转入病例继续跟踪'}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="secondary" disabled={busy||!reason.trim()}>{busy?'保存中…':closed?'重新打开事件':job.status==='succeeded'?'完成本次事件':'结束本次未完成任务'}</button></form>}
  </section>;
}
