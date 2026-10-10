import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import {agentRequest} from './agent-api.js';
import {EVENT_LABELS} from './EventCompletion.jsx';
import './agents.css';
const AgentResult=lazy(()=>import('./AgentResult.jsx'));

const LABELS={queued:'排队中',running:'执行中',succeeded:'分析完成',failed:'分析失败',cancelled:'已取消',skipped:'本任务未调用'};
const date=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'—';

export default function AgentConsole({view='tasks',initialCapture,onCaptureConsumed}){
  const [providers,setProviders]=useState([]),[rag,setRag]=useState(null),[roles,setRoles]=useState([]),[jobs,setJobs]=useState([]),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [type,setType]=useState('question'),[prompt,setPrompt]=useState(''),[scope,setScope]=useState('日常问答'),[image,setImage]=useState(null),[fileName,setFileName]=useState(''),[capture,setCapture]=useState(null),[consent,setConsent]=useState(false),[history,setHistory]=useState(false);
  const [busy,setBusy]=useState(false),[testing,setTesting]=useState(null),[selected,setSelected]=useState(null);
  const [connection,setConnection]=useState('loading'),[eventFilter,setEventFilter]=useState('open');
  const mounted=useRef(true);const operation=useRef(null);const fileGeneration=useRef(0);const fileRef=useRef(null);
  async function load(){
    try{const [p,j]=await Promise.all([agentRequest('/providers'),agentRequest('/jobs')]);if(mounted.current){setProviders(p.providers);setRag(p.rag);setRoles(p.roles);setJobs(j.jobs);setError('');setConnection('connected');}}
    catch(e){if(mounted.current){setError(e.message);setConnection('unavailable');}}
  }
  useEffect(()=>{mounted.current=true;load();const timer=setInterval(load,5000);return()=>{mounted.current=false;clearInterval(timer);};},[]);
  useEffect(()=>{
    let current=0,active=true;
    const navigate=async()=>{const turn=++current;const query=new URLSearchParams(location.hash.split('?')[1]||'');if(query.get('job')){try{const j=await agentRequest('/jobs/'+encodeURIComponent(query.get('job')));if(active&&turn===current)setSelected(j);}catch(e){if(active&&turn===current)setMessage(e.message);}}else if(query.get('scope')){setScope(query.get('scope'));setType('inspection');setSelected(null);operation.current=null;}};
    if(view==='tasks')navigate();window.addEventListener('hashchange',navigate);return()=>{active=false;window.removeEventListener('hashchange',navigate);};
  },[view]);
  const consumedCapture=useRef(null);
  useEffect(()=>{if(view!=='tasks'||!initialCapture||consumedCapture.current===initialCapture.id)return;consumedCapture.current=initialCapture.id;fileGeneration.current++;operation.current=null;setSelected(null);setType('inspection');setScope(initialCapture.scope);setImage(initialCapture.image);setCapture({kind:'camera',mode:'manual',frameId:initialCapture.id,cameraName:initialCapture.camera,width:initialCapture.width,height:initialCapture.height,capturedAt:initialCapture.capturedAt});setFileName(initialCapture.camera+' · '+new Date(initialCapture.capturedAt).toLocaleString('zh-CN'));setPrompt('请观察这张摄像头截图中的鱼体可见异常，无法看清的部位请明确说明。');setConsent(false);setMessage('摄像头截图已带入，请核对画面并填写观察描述后提交。');onCaptureConsumed?.();},[initialCapture,view,onCaptureConsumed]);
  async function fileChanged(e){
    const generation=++fileGeneration.current;const file=e.target.files?.[0];setImage(null);setFileName('');setCapture(null);operation.current=null;if(!file)return;
    if(!['image/jpeg','image/png'].includes(file.type)||file.size>4*1024*1024){setMessage('请使用不超过 4 MB 的 JPEG 或 PNG 图片。');e.target.value='';return;}
    const reader=new FileReader();reader.onload=()=>{if(generation===fileGeneration.current){setImage(reader.result);setFileName(file.name);}};reader.readAsDataURL(file);
  }
  async function submit(e){
    e.preventDefault();setBusy(true);setMessage('');
    operation.current??=crypto.randomUUID();
    try{const response=await agentRequest('/jobs',{type,prompt,scope,image:type==='inspection'?image:null,capture:type==='inspection'?capture:null,cloudConsent:consent,includeHistory:history},operation.current);operation.current=null;setMessage('任务已提交。');await load();setSelected(await agentRequest('/jobs/'+response.id));}
    catch(e){setMessage(e.message);}finally{setBusy(false);}
  }
  async function test(id){setTesting(id);setMessage('');try{const result=await agentRequest('/test',{provider:id});setMessage(result.message);}catch(e){setMessage(e.message);}finally{setTesting(null);}}
  async function open(job){try{setSelected(await agentRequest('/jobs/'+job.id));setMessage('');}catch(e){setMessage(e.message);}}
  async function cancel(job){try{await agentRequest('/jobs/'+job.id+'/cancel',{});await load();setSelected(await agentRequest('/jobs/'+job.id));}catch(e){setMessage(e.message);}}
  const deepseek=providers.find(p=>p.id==='deepseek'),qwen=providers.find(p=>p.id==='qwen');
  const ready=connection==='connected'&&!!qwen?.configured&&(type==='question'||!!deepseek?.configured);
  const configLabel=configured=>connection==='loading'?'读取中':connection==='unavailable'?'状态未知':configured?'已配置':'待配置';
  const shownJobs=view==='review'?jobs.filter(j=>j.eventState!=='not_required'&&(eventFilter==='all'||(eventFilter==='closed'?j.eventState==='closed':j.eventState!=='closed'))):jobs;
  const activeSelected=jobs.find(j=>j.id===selected?.id);
  const detail=selected&&activeSelected?{...selected,...activeSelected}:selected;
  return <section className="agent-console panel">
    <div className="agent-console-heading"><h2>{view==='settings'?'模型与知识库':view==='review'?'人工核对':detail?'任务详情':'新建任务'}</h2><div className="agent-heading-actions">{view==='tasks'&&<a href="#settings">接入设置</a>}<button className="text-button" onClick={load}>刷新</button></div></div>
    {error&&<div className="notice red" role="alert">{error}</div>}
    {message&&<div className="notice orange" role="status">{message}</div>}
    {view==='settings'&&<><div className="provider-grid">{['deepseek','qwen'].map(id=>{const p=providers.find(p=>p.id===id);return <article className="provider-card" key={id}><div><strong>{id==='deepseek'?'DeepSeek · 综合建议':'Qwen · 视觉与分析'}</strong><span className={`badge ${connection==='connected'&&p?.configured?'green':'gray'}`}>{configLabel(p?.configured)}</span></div><p>{p?.model||(connection==='connected'?'模型待配置':'—')}</p><small>{p?.baseUrl}</small><button className="text-button" disabled={connection!=='connected'||!p?.configured||!!testing} onClick={()=>test(id)}>{testing===id?'测试中…':'测试连接（调用 API）'}</button></article>;})}</div><details className="agent-config-help"><summary>配置说明</summary><p className="muted config-hint">配置文件：backend/.env，保存后刷新。密钥仅在后端使用。</p><p className="muted">每次任务最多检索 2 次；问答最多请求模型 3 次，图像任务最多 5 次。失败不自动重试。</p></details></>}
    {view==='settings'&&<article className="provider-card"><div><strong>Coze · 鱼病资料库</strong><span className={`badge ${connection==='connected'&&rag?.configured?'green':'gray'}`}>{configLabel(rag?.configured)}</span></div><p>图像特征先检索，保留原文与来源。</p><small>{rag?.url}</small><button className="text-button" disabled={connection!=='connected'||!rag?.configured||!!testing} onClick={()=>test('rag')}>{testing==='rag'?'测试中…':'测试检索'}</button></article>}
    {view==='settings'&&<><h3>后端固定的工具权限</h3><div className="table-scroll"><table><thead><tr><th>角色</th><th>模型服务</th><th>允许工具</th></tr></thead><tbody>{roles.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.provider}</td><td>{r.tools.join('、')}</td></tr>)}</tbody></table></div><p className="muted">Agent 无审核、删除、任意 SQL 或任意文件访问工具。当前只适用于本机单人使用，尚无多人账号和角色管理。Coze 知识库只读检索；模型无权修改资料或审核结果。尚未接入微调模型。</p></>}
    {view==='tasks'&&!detail&&<form className="agent-form" onSubmit={submit}>
      <div className="agent-input-row"><label>任务类型<select value={type} onChange={e=>{setType(e.target.value);setScope(current=>current==='鱼缸01'||current==='日常问答'?(e.target.value==='question'?'日常问答':'鱼缸01'):current);setCapture(null);operation.current=null;}}><option value="question">日常 / 鱼类问答</option><option value="inspection">图像分析</option></select></label><label>{type==='question'?'话题 / 观察对象':'观察对象'}<input required maxLength={80} value={scope} onChange={e=>{setScope(e.target.value);operation.current=null;}} placeholder={type==='question'?'例如日常问答、学习，或鱼缸01':'例如鱼缸01'}/></label></div>
      {type==='inspection'&&<label>鱼体图片（JPEG / PNG，最大 4 MB）<input ref={fileRef} type="file" accept="image/jpeg,image/png" onChange={fileChanged}/>{image&&<img className="agent-upload-preview" src={image} alt="本次待分析图片"/>}{fileName&&<small>{fileName}</small>}</label>}
      <label>问题或观察描述<textarea required rows={4} maxLength={4000} value={prompt} onChange={e=>{setPrompt(e.target.value);operation.current=null;}} placeholder={type==='question'?'可以问日常常识、学习、写作、基础编程或鱼类养殖问题…':'鱼种、发现时间、异常表现…'}/></label>
      <label className="checkbox"><input type="checkbox" checked={history} onChange={e=>{setHistory(e.target.checked);operation.current=null;}}/>使用同话题 / 对象最近 5 次任务与核对记录</label>
      <label className="checkbox"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>同意云端处理本次内容，并按需检索 Coze 资料库（可能产生费用）</label>
      <details className="agent-data-notice"><summary>数据使用说明</summary><p className="muted">本次文字、图片，以及勾选的历史记录会发送给云端模型。需要检索时，症状查询会发送到 Coze，返回的资料片段会交给模型分析。请勿填写密钥等敏感信息。</p></details>
      <div className="agent-form-footer"><button className="primary" disabled={busy||!ready||!consent||(type==='inspection'&&!image)}>{busy?'提交中…':'开始分析'}</button></div>
      {connection==='connected'&&!ready&&<p className="form-error">请在接入设置中配置 {qwen?.configured?'DeepSeek':'Qwen'}。</p>}
    </form>}
    {detail&&view!=='settings'&&<Suspense fallback={<p className="muted">正在打开任务…</p>}><AgentResult job={detail} onClose={()=>setSelected(null)} onCancel={cancel} onReviewed={job=>{setSelected(job);load();}}/></Suspense>}
    {view!=='settings'&&!detail&&<><h3 className="agent-history-heading">{view==='review'?'核对记录':'任务记录'}</h3>{view==='review'&&<label className="event-filter">显示<select value={eventFilter} onChange={e=>setEventFilter(e.target.value)}><option value="open">未结束</option><option value="closed">已结束</option><option value="all">全部</option></select></label>}{shownJobs.length?<div className="table-scroll"><table><thead><tr><th>创建时间 / 对象</th><th>任务</th><th>状态</th><th>操作</th></tr></thead><tbody>{shownJobs.map(j=><tr key={j.id}><td>{date(j.createdAt)}<small>{j.scope}</small></td><td>{j.type==='question'?'文字问答':'图像分析'}<small>{j.prompt.slice(0,45)}</small></td><td><span className={`badge ${j.status==='failed'?'red':j.status==='succeeded'?'green':'gray'}`}>{LABELS[j.status]}</span>{j.eventState&&j.eventState!=='not_required'&&<small>{EVENT_LABELS[j.eventState]}</small>}</td><td><button className="text-button" onClick={()=>open(j)}>查看结果</button></td></tr>)}</tbody></table></div>:<div className="empty"><strong>{connection==='loading'?'正在读取记录…':connection==='unavailable'?'暂时无法读取记录':'暂无任务'}</strong></div>}</>}

  </section>;
}
