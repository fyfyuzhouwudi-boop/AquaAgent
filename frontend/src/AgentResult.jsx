import React from 'react';
import ModelAnswer from './ModelAnswer.jsx';
import ReviewPanel from './ReviewPanel.jsx';
import {agentProgress} from './agent-progress.js';
import EventCompletion from './EventCompletion.jsx';
import {agentRequest} from './agent-api.js';

const STATUS={queued:'排队中',running:'执行中',succeeded:'已完成',failed:'失败',cancelled:'已取消',skipped:'未调用'};
const Answer=ModelAnswer;

export default function AgentResult({job,onClose,onCancel,onReviewed}){
  const canReview=job.status==='succeeded'&&(job.type==='inspection'||['pending','reviewed'].includes(job.reviewStatus));
  const answer=job.steps.find(s=>s.id==='coordinator'&&s.status==='succeeded')?.output;
  const followup=job.steps.find(s=>s.id==='followup'&&s.status==='succeeded')?.output;
  return <article className="task-detail" aria-label="任务详情">
    <header className="task-detail-heading"><div><h3>{job.scope} · {job.type==='inspection'?'图像分析':'文字问答'}</h3><span className={`badge ${job.status==='failed'?'red':job.status==='succeeded'?'green':'gray'}`}>{job.status==='succeeded'?'分析完成':STATUS[job.status]}</span><small>{new Date(job.createdAt).toLocaleString('zh-CN',{hour12:false})}</small></div><button className="text-button" onClick={onClose}>返回任务列表</button></header>
    <section className="agent-activity" aria-label="Agent 协作状态">
      <div className="agent-activity-heading"><h3>Agent 协作</h3></div>
      <div className="agent-activity-grid">{agentProgress(job).map(step=><section key={step.id} className={`activity-card activity-${step.status}`}>
        <header><strong>{step.name}</strong><span className={`badge ${step.status==='running'?'blue':step.status==='failed'?'red':step.status==='succeeded'?'green':'gray'}`}>{step.label}</span></header>
        <p className="activity-purpose">{step.work}</p>
        {(step.output||['running','failed','cancelled'].includes(step.status))&&<details className="activity-record"><summary>{step.status==='running'?'查看进度':'查看记录'}</summary>
          {step.model&&<small className="activity-model">{step.model}</small>}
          {step.output?<Answer text={step.output}/>:<p>{step.detail}</p>}
        </details>}
      </section>)}</div>
    </section>
    <div className={`task-result-layout ${canReview?'':'no-review'}`}>
      <div className="task-result-main">
        <section className="task-question"><strong>本次观察</strong><p>{job.prompt}</p>{job.image&&<details><summary>查看原图</summary><a href={job.image} target="_blank" rel="noopener noreferrer"><img className="task-source-image" src={job.image} alt="本次任务原始图片"/></a></details>}</section>
        {job.error&&<div className="notice red" role="alert">{job.error}</div>}
        <section className="task-conclusion"><h3>{job.finalAdvice?'综合判断与处理建议 · DeepSeek':'分析结果'}</h3>{job.status==='succeeded'?<Answer text={job.finalAdvice?job.result:(answer||job.result)}/>:<p className="muted">{['queued','running'].includes(job.status)?'正在分析，完成后会在这里显示结果。':'本次任务未生成完整结果。'}</p>}</section>
        {job.finalAdvice&&answer&&<details className="task-fold"><summary>Qwen 分析依据</summary><Answer text={answer}/></details>}
        {!job.finalAdvice&&followup&&job.status==='succeeded'&&<details className="task-fold"><summary>复查建议</summary><Answer text={followup}/></details>}
        <details className="task-fold"><summary>参考资料 · {job.sources?.length||0} 条</summary>{job.sources?.length?<><p className="muted">检索相关度不是疾病概率，资料需结合实际情况核对。</p>{job.sources.map(source=><details className="source-item" key={source.id}><summary>[{source.id}] {source.source||source.title}</summary><small>页码：{source.page??'未提供'} · 相关度：{source.score??'未提供'}</small><pre>{source.text}</pre></details>)}</>:<p className="muted">{job.retrievals?.some(r=>r.status==='failed')?'资料检索失败。':job.retrievals?.length?'本次检索未找到资料。':'本次未检索资料库。'}</p>}</details>
        <details className="task-fold task-process"><summary>执行过程 · {job.steps.filter(s=>s.status==='succeeded').length}/{job.steps.filter(s=>s.status!=='skipped').length} 步完成</summary>
          <ol className="agent-timeline">{[...job.steps].sort((a,b)=>(a.startedAt||'9999').localeCompare(b.startedAt||'9999')).map(step=><li key={step.id}><div><strong>{step.name}</strong><span className={`badge ${step.status==='failed'?'red':'gray'}`}>{STATUS[step.status]}</span></div><small>{step.provider} · {step.model||'—'}</small>{step.output&&<details><summary>步骤输出</summary><Answer text={step.output}/></details>}</li>)}</ol>
          {!!job.retrievals?.length&&<details><summary>检索记录 · {job.retrievals.length} 次</summary>{job.retrievals.map((r,i)=><section className="retrieval-item" key={i}><strong>{r.query}</strong><p>{r.reason}</p><small>{r.status==='failed'?'检索失败':r.status==='empty'?'无结果':r.status==='running'?'检索中':'检索完成'}</small>{r.error&&<p className="form-error">{r.error}</p>}</section>)}</details>}
          <small className="task-id">任务编号：{job.id} · 使用历史记录：{job.historyIds?.length||0} 条</small>
        </details>
        <EventCompletion key={job.id+':'+job.version} job={job} onChanged={async()=>onReviewed(await agentRequest('/jobs/'+job.id))}/>
        {['queued','running'].includes(job.status)&&<button className="secondary" onClick={()=>onCancel(job)}>停止后续执行</button>}
      </div>
      {canReview&&<ReviewPanel key={job.id+':'+(job.resolution?.at||'')} job={job} onSaved={onReviewed}/>}
    </div>
  </article>;
}
