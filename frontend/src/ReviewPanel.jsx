import React,{useEffect,useRef,useState} from 'react';
import {agentRequest} from './agent-api.js';
import CaseLink from './CaseLink.jsx';

const DECISIONS={needs_evidence:'需要补充证据',accepted:'认可本次观察描述',rejected:'不认可本次分析'};
const fileUrl=(jobId,id)=>`/api/agents/jobs/${jobId}/attachments/${id}`;
const size=n=>n>=1024*1024?`${(n/1024/1024).toFixed(1)} MB`:`${Math.ceil(n/1024)} KB`;

function SavedFiles({jobId,files=[]}){
  return <div className="review-saved-files">{files.map(file=><a key={file.id} href={fileUrl(jobId,file.id)+'?download=1'} download={file.name}>
    {file.type.startsWith('image/')&&<img src={fileUrl(jobId,file.id)} alt={file.name} loading="lazy"/>}
    <span>{file.name}<small>{size(file.size)} · 下载</small></span>
  </a>)}</div>;
}

export default function ReviewPanel({job,onSaved}){
  const [decision,setDecision]=useState(job.review?.decision||'needs_evidence');
  const [reason,setReason]=useState('');
  const [files,setFiles]=useState([]),[retained,setRetained]=useState(job.review?.attachments||[]);
  const [baseVersion,setBaseVersion]=useState(job.version);
  const [reading,setReading]=useState(false),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
  const generation=useRef(0),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  const conflict=job.version!==baseVersion;
  async function chooseFiles(event){
    const incoming=[...event.target.files];event.target.value='';if(!incoming.length)return;
    if(files.length+retained.length+incoming.length>4){setNotice('最多添加 4 个附件。');return;}
    if([...files,...retained,...incoming].reduce((n,f)=>n+f.size,0)>4*1024*1024){setNotice('附件合计不能超过 4 MB。');return;}
    const allowed={'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','pdf':'application/pdf','txt':'text/plain'};
    if(incoming.some(f=>!allowed[f.name.split('.').pop().toLowerCase()]||!f.size)){setNotice('请选择非空的 JPG、PNG、PDF 或 TXT 文件。');return;}
    const turn=++generation.current;setReading(true);setNotice('');
    try{
      const added=await Promise.all(incoming.map(file=>new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onerror=()=>reject(new Error('文件读取失败，请重新选择。'));
        reader.onload=()=>{const type=allowed[file.name.split('.').pop().toLowerCase()];resolve({id:crypto.randomUUID(),name:file.name,size:file.size,type,data:`data:${type};base64,${String(reader.result).split(',')[1]}`});};reader.readAsDataURL(file);
      })));
      if(alive.current&&turn===generation.current)setFiles(previous=>[...previous,...added]);
    }catch(error){if(alive.current)setNotice(error.message);}
    finally{if(alive.current&&turn===generation.current)setReading(false);}
  }
  async function save(event){
    event.preventDefault();setSaving(true);setNotice('');
    try{
      await agentRequest(`/jobs/${job.id}/review`,{version:baseVersion,decision,reason,retainedAttachmentIds:retained.map(f=>f.id),attachments:files.map(({name,data})=>({name,data}))});
      const latest=await agentRequest(`/jobs/${job.id}`);
      if(!alive.current)return;
      setBaseVersion(latest.version);setRetained(latest.review?.attachments||[]);setFiles([]);setReason('');setNotice(decision==='needs_evidence'?'已保存，事件仍等待补充证据。':'核对已保存，请确认是否结束本次事件。');window.dispatchEvent(new Event('fish-event-updated'));onSaved(latest);
    }catch(error){if(alive.current)setNotice(error.message);}
    finally{if(alive.current)setSaving(false);}
  }
  return <aside className="review-panel">
    <h3>人工核对</h3>
    {job.review&&<section className="review-last"><span className={`badge ${job.review.decision==='needs_evidence'?'orange':'green'}`}>{job.review.decision==='needs_evidence'?'待补充证据':'已核对'}</span><p><strong>{DECISIONS[job.review.decision]}</strong></p><p>{job.review.reason}</p><small>{new Date(job.review.at).toLocaleString('zh-CN',{hour12:false})}</small><SavedFiles jobId={job.id} files={job.review.attachments}/></section>}
    <CaseLink job={job} disabled={saving||reading||conflict||!!reason.trim()||files.length>0} onLinked={latest=>{setBaseVersion(latest.version);onSaved(latest);}}/>
    {job.eventState!=='closed'&&<form onSubmit={save}>
      <label>核对结论<select value={decision} disabled={saving} onChange={e=>setDecision(e.target.value)}>{Object.entries(DECISIONS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>核对依据<textarea required rows={4} maxLength={1000} disabled={saving} value={reason} onChange={e=>setReason(e.target.value)} placeholder="补充观察、检查结果或修正意见"/></label>
      <label className="review-upload">添加图片或附件<input type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.txt" disabled={saving||reading||conflict} onChange={chooseFiles}/><small>最多 4 个，合计 4 MB · 仅保存在本机</small></label>
      <div className="review-pending-files">{[...retained,...files].map(file=><div key={file.id}>
        {file.type.startsWith('image/')&&<img src={file.data||fileUrl(job.id,file.id)} alt={`待保存：${file.name}`}/>}
        <span>{file.name}<small>{size(file.size)}{file.data?' · 待保存':' · 已保留'}</small></span><button type="button" className="text-button" disabled={saving||reading} aria-label={`移除 ${file.name}`} onClick={()=>{setFiles(list=>list.filter(f=>f.id!==file.id));setRetained(list=>list.filter(f=>f.id!==file.id));}}>移除</button>
      </div>)}</div>
      {conflict&&<p className="form-error">记录已更新，请重新打开此任务后核对。</p>}
      {notice&&<p role="status" className="review-notice">{notice}</p>}
      <button className="primary" disabled={saving||reading||conflict||!reason.trim()}>{saving?'保存中…':reading?'读取附件…':'保存核对'}</button>
    </form>}
    {!!job.reviewHistory?.length&&<details className="review-history"><summary>历史核对 · {job.reviewHistory.length} 次</summary>{[...job.reviewHistory].reverse().map((review,i)=><section key={i}><strong>{DECISIONS[review.decision]}</strong><p>{review.reason}</p><small>{new Date(review.at).toLocaleString('zh-CN',{hour12:false})}</small><SavedFiles jobId={job.id} files={review.attachments}/></section>)}</details>}
  </aside>;
}
