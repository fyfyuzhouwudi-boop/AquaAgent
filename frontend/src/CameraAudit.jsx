import React,{useState,lazy,Suspense} from 'react';
const LazyAnswer=lazy(()=>import('./ModelAnswer.jsx'));
function ModelAnswer(props){return <Suspense fallback={<p>正在打开内容…</p>}><LazyAnswer {...props}/></Suspense>;}
import './camera-audit.css';
import EventCompletion,{EVENT_LABELS} from './EventCompletion.jsx';

const date=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
const state=record=>EVENT_LABELS[record.eventState]||'状态读取中';

export default function CameraAudit({records=[],error='',compact=false,onRefresh}){
  const [selected,setSelected]=useState(null),[filter,setFilter]=useState('all');
  const filtered=records.filter(r=>filter==='all'||(filter==='closed'?r.eventState==='closed':r.eventState!=='closed'));
  const shown=records.find(record=>record.id===selected)||null;
  return <section className="panel camera-audit" aria-label="图像分析审计">
    <header className="camera-audit-header"><div><h2>图像分析审计</h2><p>每张已提交的摄像头截图单独记录分析与人工核对过程。</p></div><div>{compact?<a className="text-button" href="#audit">查看全部</a>:<button className="text-button" onClick={onRefresh}>刷新记录</button>}</div></header>
    {error&&<p className="notice red" role="alert">审计记录暂时无法读取：{error}</p>}
    {!records.length&&!error?<p className="muted">暂无摄像头分析记录。连接摄像头并提交抽帧后会显示在这里。</p>:null}
    {!compact&&!!records.length&&<label className="event-filter">显示<select value={filter} onChange={e=>{setFilter(e.target.value);setSelected(null);}}><option value="all">全部记录</option><option value="open">未结束</option><option value="closed">已结束</option></select><span>{filtered.length} 条</span></label>}
    {!compact&&records.length>0&&!filtered.length&&<p className="muted">暂无符合条件的记录。</p>}
    {!!records.length&&<div className="camera-audit-list">{filtered.slice(0,compact?3:200).map(record=><button key={record.id} className={`camera-audit-row ${selected===record.id?'selected':''}`} onClick={()=>setSelected(selected===record.id?null:record.id)}>
      <span><strong>{record.scope}</strong><small>{date(record.capture.capturedAt)} · {record.capture.mode==='scheduled'?'定时抽帧':'手动截图'}</small></span>
      <span className={`badge ${record.eventState==='closed'?'green':['failed','cancelled'].includes(record.eventState)?'red':record.eventNeedsAttention?'orange':'gray'}`}>{state(record)}</span>
    </button>)}</div>}
    {shown&&<article className="camera-audit-detail" aria-label="本张图片分析记录">
      <div className="camera-audit-detail-head"><strong>{shown.scope} · {date(shown.capture.capturedAt)}</strong><a href={`#agents?job=${encodeURIComponent(shown.id)}`}>打开完整任务与人工核对</a></div>
      <div className="camera-audit-detail-grid"><img src={shown.imageUrl} alt={`${shown.scope} 的原始抽帧`}/><div><p>摄像头：{shown.capture.cameraName}</p><p>分辨率：{shown.capture.width} × {shown.capture.height}</p><p>任务状态：{state(shown)}</p><p>任务编号：{shown.id}</p>{shown.error&&<p className="form-error">{shown.error}</p>}</div></div>
      <h3>视觉 Agent 观察</h3><ModelAnswer className="camera-audit-answer" text={shown.observation||'尚无完整视觉输出。'}/>
      <EventCompletion key={shown.id+':'+shown.version} job={shown} onChanged={onRefresh}/>
      {shown.finalAdvice&&<><h3>综合判断与处理建议 · DeepSeek</h3><ModelAnswer className="camera-audit-answer" text={shown.finalAdvice}/></>}
      <h3>主 Agent 分析</h3><ModelAnswer className="camera-audit-answer" text={shown.assessment||'尚无完整分析结论。'}/>
      <h3>调用记录</h3><div className="camera-audit-steps">{shown.steps.map(step=><div key={step.id}><strong>{step.name}</strong><span>{step.status==='skipped'?'未调用':step.status==='succeeded'?'已完成':step.status==='failed'?'失败':step.status==='running'?'执行中':'待执行'}</span><small>{step.model||step.provider}{step.tools?.length?` · ${step.tools.join('、')}`:''}</small></div>)}</div>
      <p className="muted">资料检索 {shown.retrievals?.length||0} 次，返回来源 {shown.sources?.length||0} 条。{shown.review?`人工核对：${shown.review.reason}`:'分析结果尚未经人工核对。'}</p>
      {!!shown.events?.length&&<details className="camera-audit-events"><summary>审计时间线 · {shown.events.length} 条</summary><ol>{[...shown.events].reverse().map((entry,index)=><li key={`${entry.at}-${index}`}><strong>{date(entry.at)} · {entry.action}</strong><span>{entry.detail}</span></li>)}</ol></details>}
    </article>}
  </section>;
}
