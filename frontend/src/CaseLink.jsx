import React,{useState,useRef} from 'react';
import {agentRequest} from './agent-api.js';

export default function CaseLink({job,onLinked,disabled}){
  const [mode,setMode]=useState(''),[cases,setCases]=useState([]),[target,setTarget]=useState(''),[title,setTitle]=useState(`${job.scope} · 异常观察`),[due,setDue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const operation=useRef(null);
  async function choose(mode){setMode(mode);setError('');operation.current=null;if(mode==='link'){try{const r=await agentRequest('/cases');setCases(r.cases.filter(c=>c.scope===job.scope&&c.status==='observing'));}catch(e){setError(e.message);}}}
  async function save(e){e.preventDefault();setBusy(true);setError('');try{
    const selected=cases.find(c=>c.id===target);
    const body=mode==='create'?{jobId:job.id,jobVersion:job.version,title,nextReviewAt:due?new Date(due).toISOString():null}:{jobId:job.id,jobVersion:job.version,version:selected?.version};
    operation.current??=crypto.randomUUID();
    await agentRequest(mode==='create'?'/cases':`/cases/${target}/link`,body,operation.current);
    const latest=await agentRequest(`/jobs/${job.id}`);onLinked(latest);setMode('');operation.current=null;
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  if(job.caseId)return <div className="case-link-box"><span>已归入病例</span><a href={`#cases?case=${job.caseId}`}>查看病例与随访 →</a></div>;
  if(!job.review)return null;
  return <section className="case-link-box"><strong>继续跟踪</strong><div className="case-link-actions"><button type="button" className="secondary" disabled={busy||disabled} onClick={()=>choose('create')}>建立病例</button><button type="button" className="secondary" disabled={busy||disabled} onClick={()=>choose('link')}>关联已有病例</button></div>
    {mode&&<form onSubmit={save} onChange={()=>{operation.current=null;}}>
      {mode==='create'?<><label>病例名称<input disabled={busy} required maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>下次复查（选填）<input disabled={busy} type="datetime-local" value={due} onInput={e=>{setDue(e.currentTarget.value);operation.current=null;}} onChange={e=>setDue(e.target.value)}/></label></>:<label>同一观察对象的病例<select disabled={busy} required value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择病例</option>{cases.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select>{!cases.length&&<small>暂无可关联的观察中病例，可先建立病例。</small>}</label>}
      <div className="case-link-actions"><button className="primary" disabled={busy||disabled||(mode==='link'&&!target)}>{busy?'保存中…':'确认关联'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>setMode('')}>取消</button></div>
    </form>}{error&&<p className="form-error" role="alert">{error}</p>}
  </section>;
}
