import React,{useEffect,useRef,useState} from 'react';
import ModelAnswer from './ModelAnswer.jsx';
import {agentRequest} from './agent-api.js';
import './cases.css';

const date=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'未安排';
const selectedId=()=>new URLSearchParams(location.hash.split('?')[1]||'').get('case');
const toLocal=v=>{if(!v)return '';const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const REVIEW={accepted:'认可观察描述，继续跟踪',rejected:'不认可本次分析',needs_evidence:'需要补充证据'};
function Files({files=[],base}){return <div className="case-files">{files.map(f=><a key={f.id} href={`${base}/${f.id}?download=1`} download={f.name}>{f.type.startsWith('image/')&&<img src={`${base}/${f.id}`} alt={f.name} loading="lazy"/>}<span>{f.name} · 下载</span></a>)}</div>;}
function ResultText({children}){return <ModelAnswer className="case-result-text" text={children}/>;}

function CaseForm({record,onSaved}){
  const [action,setAction]=useState(record.status==='closed'?'reopen':'followup'),[note,setNote]=useState(''),[observed,setObserved]=useState(toLocal(new Date().toISOString())),[due,setDue]=useState(toLocal(record.nextReviewAt)),[files,setFiles]=useState([]),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState('');
  const operation=useRef(null),alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function upload(event){
    const incoming=[...event.target.files];event.target.value='';const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',pdf:'application/pdf',txt:'text/plain'};
    if(files.length+incoming.length>4||[...files,...incoming].reduce((n,f)=>n+f.size,0)>4*1024*1024){setError('最多 4 个附件，合计不超过 4 MB。');return;}
    if(incoming.some(f=>!types[f.name.split('.').pop().toLowerCase()]||!f.size)){setError('请选择 JPG、PNG、PDF 或 UTF-8 TXT 文件。');return;}
    setReading(true);setError('');try{const next=await Promise.all(incoming.map(f=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({id:crypto.randomUUID(),name:f.name,size:f.size,type:types[f.name.split('.').pop().toLowerCase()],data:`data:${types[f.name.split('.').pop().toLowerCase()]};base64,${String(reader.result).split(',')[1]}`});reader.onerror=()=>reject(new Error('附件读取失败。'));reader.readAsDataURL(f);})));if(alive.current){setFiles(old=>[...old,...next]);operation.current=null;}}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setReading(false);}
  }
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{
    const body={version:record.version,note,nextReviewAt:due?new Date(due).toISOString():null,...(action==='followup'?{observedAt:observed?new Date(observed).toISOString():null,attachments:files.map(({name,data})=>({name,data}))}:{})};
    operation.current??=crypto.randomUUID();await agentRequest(`/cases/${record.id}/${action}`,body,operation.current);onSaved(await agentRequest(`/cases/${record.id}`));
  }catch(e){setError(e.message);}finally{if(alive.current)setBusy(false);}}
  return <form className="case-form" onSubmit={submit} onChange={()=>{operation.current=null;}}><h3>{record.status==='closed'?'重新观察':'记录复查'}</h3>
    {record.status!=='closed'&&<label>操作<select value={action} disabled={busy} onChange={e=>setAction(e.target.value)}><option value="followup">添加复查记录</option><option value="close">人工结案</option></select></label>}
    {action==='followup'&&<label>观察时间<input type="datetime-local" required value={observed} disabled={busy} onInput={e=>{setObserved(e.currentTarget.value);operation.current=null;}} onChange={e=>setObserved(e.target.value)}/></label>}
    <label>{action==='followup'?'观察与检查结果':action==='close'?'结案依据':'重新观察原因'}<textarea rows={4} required maxLength={3000} disabled={busy} value={note} onChange={e=>setNote(e.target.value)} placeholder={action==='followup'?'记录体表、摄食、行为及与上次的变化':'请填写具体依据'}/></label>
    {action!=='close'&&<label>下次复查（选填）<input type="datetime-local" value={due} disabled={busy} onInput={e=>{setDue(e.currentTarget.value);operation.current=null;}} onChange={e=>setDue(e.target.value)}/></label>}
    {action==='followup'&&<><label>照片或附件<input type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.txt" disabled={busy||reading} onChange={upload}/><small>最多 4 个，合计 4 MB · 本机保存</small></label><div className="case-pending-files">{files.map(f=><div key={f.id}>{f.type.startsWith('image/')&&<img src={f.data} alt={f.name}/>}<span>{f.name}</span><button type="button" className="text-button" disabled={busy||reading} onClick={()=>{setFiles(old=>old.filter(x=>x.id!==f.id));operation.current=null;}}>移除</button></div>)}</div></>}
    {error&&<p role="alert" className="form-error">{error}</p>}<button className="primary" disabled={busy||reading||!note.trim()}>{busy?'保存中…':reading?'读取附件…':action==='close'?'确认结案':action==='reopen'?'恢复观察':'保存复查'}</button><small className="case-local-reminder">复查时间用于本页到期提示，不发送消息提醒。</small>
  </form>;
}

export default function CaseConsole(){
  const [cases,setCases]=useState([]),[record,setRecord]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[filter,setFilter]=useState('all');
  const generation=useRef(0),active=useRef(true);
  async function load(){const turn=++generation.current;setLoading(true);setRecord(null);try{const r=await agentRequest('/cases');const id=selectedId(),detail=id?await agentRequest(`/cases/${id}`):null;if(active.current&&turn===generation.current){setCases(r.cases);setRecord(detail);setError('');}}catch(e){if(active.current&&turn===generation.current)setError(e.message);}finally{if(active.current&&turn===generation.current)setLoading(false);}}
  useEffect(()=>{active.current=true;load();const handler=()=>load();window.addEventListener('hashchange',handler);return()=>{active.current=false;generation.current++;window.removeEventListener('hashchange',handler);};},[]);
  const due=c=>c.status==='observing'&&c.nextReviewAt&&Date.parse(c.nextReviewAt)<=Date.now();
  const shown=cases.filter(c=>filter==='all'||(filter==='due'?due(c):c.status===filter));
  return <section className="panel real-cases">
    <header className="real-cases-heading"><h2>{record?'病例档案':'病例记录'}</h2><div>{record&&<a href="#cases">返回列表</a>}<button className="text-button" onClick={load}>刷新病例</button></div></header>
    {error&&<p className="notice red" role="alert">{error}</p>}{loading&&<p role="status" className="muted">正在读取病例…</p>}
    {!loading&&!record&&!selectedId()&&<><div className="tabs case-tabs">{[['all','全部'],['observing','观察中'],['due','待复查'],['closed','已结案']].map(([value,label])=><button key={value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{label} · {cases.filter(c=>value==='all'||(value==='due'?due(c):c.status===value)).length}</button>)}</div>
      {shown.length?<div className="real-case-grid">{shown.map(c=><a className="real-case-card" key={c.id} href={`#cases?case=${c.id}`}><div><h3>{c.title}</h3><span className={`badge ${c.status==='closed'?'gray':'green'}`}>{c.status==='closed'?'已结案':'观察中'}</span></div><p>{c.scope}</p><p>{c.taskCount} 次关联分析 · {c.followupCount} 次复查</p><small>下次复查：{date(c.nextReviewAt)}</small>{due(c)&&<span className="badge orange">已到复查时间</span>}</a>)}</div>:<div className="empty"><strong>{filter==='all'?'暂无病例':'暂无符合条件的病例'}</strong><p>在 Agent 任务完成人工核对后，选择“建立病例”。</p><a href="#agents">前往 Agent 任务 →</a></div>}</>}
    {record&&!loading&&<><div className="case-overview"><div><h2>{record.title}</h2><p>{record.scope} · 建档于 {date(record.createdAt)}</p></div><span className={`badge ${record.status==='closed'?'gray':'green'}`}>{record.status==='closed'?'已结案':'观察中'}</span></div><div className="case-next"><span>下次复查：{date(record.nextReviewAt)}</span>{due(record)&&<span className="badge orange">已到复查时间</span>}{record.status==='observing'&&<a href={`#agents?scope=${encodeURIComponent(record.scope)}`}>新增图片分析 →</a>}</div>
      <div className="case-detail-layout"><section className="case-timeline"><h3>病例时间线</h3>{[
        ...record.links.map(link=>({...link,kind:'task',id:link.jobId})),...record.entries
      ].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).map(item=>{
        const job=item.kind==='task'?record.jobs.find(j=>j.id===item.jobId):null;
        return <article className="case-timeline-entry" key={`${item.kind}-${item.id}`}><header><strong>{item.kind==='task'?'关联分析':item.kind==='followup'?'人工复查':item.kind==='close'?'人工结案':'重新观察'}</strong><small>{date(item.observedAt||item.at)}</small></header>
          {job&&!job.missing?<><p>{job.prompt}</p>{job.hasImage&&<img className="case-observation-image" src={`/api/agents/jobs/${job.id}/image`} alt="关联任务原始图片" loading="lazy"/>}<p><strong>关联时核对：</strong>{REVIEW[item.review.decision]} · {item.review.reason}</p><Files files={item.review.attachments} base={`/api/agents/jobs/${job.id}/attachments`}/><details><summary>查看分析结果</summary><ResultText>{job.result}</ResultText></details><details><summary>当前核对与资料来源</summary><p>{REVIEW[job.review?.decision]} · {job.review?.reason}</p><Files files={job.review?.attachments} base={`/api/agents/jobs/${job.id}/attachments`}/>{job.sources.map(s=><details key={s.id}><summary>[{s.id}] {s.source||s.title}</summary><p>{s.text}</p></details>)}</details><a href={`#agents?job=${job.id}`}>打开原始任务 →</a></>:<><p>{item.kind==='task'?'原始任务暂时无法读取。':item.note}</p><Files files={item.attachments} base={`/api/agents/cases/${record.id}/attachments`}/></>}
        </article>;
      })}</section><CaseForm key={`${record.id}-${record.version}`} record={record} onSaved={r=>{setRecord(r);setCases(old=>old.map(c=>c.id===r.id?{...c,status:r.status,nextReviewAt:r.nextReviewAt,version:r.version,followupCount:r.entries.filter(e=>e.kind==='followup').length}:c));}}/></div>
    </>}
  </section>;
}
