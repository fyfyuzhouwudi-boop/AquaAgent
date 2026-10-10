import {EVENT_LABELS} from './EventCompletion.jsx';
import React, {useCallback,useEffect,useRef,useState,lazy,Suspense} from 'react';
import { FishSimple, House, CalendarDots, Warning, Robot, ClipboardText, GearSix, Bell, CaretRight, Play, ArrowsOut, Clock, X, Check, MagnifyingGlass, ArrowClockwise, Pause, DownloadSimple, UploadSimple, List, VideoCamera, ShieldCheck, ArrowRight, CaretDown, CircleNotch, SignOut, FileText } from '@phosphor-icons/react';
import { api } from './api.js';
import AgentConsole from './AgentConsole.jsx';
import CameraPanel from './CameraPanel.jsx';
import CameraAudit from './CameraAudit.jsx';
import {agentRequest} from './agent-api.js';
const CaseConsole=lazy(()=>import('./CaseConsole.jsx'));
import './cases.css';
import { ASSET, EVENT_STATUS, TASK_STATUS } from './domain.js';

const NAV=[['dashboard','巡检工作台',House],['plans','巡检计划',CalendarDots],['events','事件中心',Warning],['agents','Agent 任务',Robot],['audit','图像审计',FileText],['cases','病例与随访',ClipboardText],['settings','设备与设置',GearSix]];
const ROLES=['视觉巡检','调度分派','证据研判','病例整理'];
const DECISIONS={confirmed:'确认异常',false_positive:'标记误报',needs_evidence:'要求补充',observe:'继续观察',close:'结束观察并关闭'};
const time=value=>value?new Date(value).toLocaleTimeString('zh-CN',{hour12:false}):'—';
const date=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
const initialRoute=()=>{const route=location.hash.slice(1).split('?')[0];return NAV.some(n=>n[0]===route)?route:'dashboard';};

function Badge({status,task=false,children,tone}) {
  const [label,color]=(task?TASK_STATUS:EVENT_STATUS)[status]||[children||status,tone||'gray'];
  return <span className={`badge ${tone||color}`}>{children||label}</span>;
}
function Empty({title='暂无记录',text='新的记录将显示在这里。'}) {return <div className="empty"><ClipboardText size={32}/><strong>{title}</strong><p>{text}</p></div>;}
function Modal({title,onClose,children,wide=false}) {
  const dialog=useRef(null);
  useEffect(()=>{const el=dialog.current;el.showModal();return()=>{if(el.open)el.close();};},[]);
  return <dialog ref={dialog} className={`modal ${wide?'wide':''}`} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <header><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><X size={22}/></button></header>
    <div className="modal-body">{children}</div>
  </dialog>;
}
function EventTable({events,points,onOpen}) {
  if(!events.length)return <Empty title="没有符合条件的事件" text="可以切换筛选条件查看其他事件。"/>;
  return <div className="table-scroll"><table><thead><tr><th>事件时间</th><th>监控点</th><th>可见异常</th><th>事件状态</th><th>操作</th></tr></thead><tbody>{events.map(e=><tr key={e.id}>
    <td className="numeric">{date(e.createdAt)}<small>{e.id}</small></td><td>{points.find(p=>p.id===e.pointId)?.name||e.pointId}</td>
    <td>{e.title}</td><td><Badge status={e.status}/></td><td><button className="text-button" onClick={()=>onOpen(e)}>{e.status==='pending_review'?'去复核':'查看'}<CaretRight size={14}/></button></td>
  </tr>)}</tbody></table></div>;
}
function EventDetail({event,data,onClose,onChanged,notify}) {
  const [reason,setReason]=useState('');const [decision,setDecision]=useState('observe');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [shown,setShown]=useState(()=>structuredClone(event));
  const point=data.points.find(p=>p.id===event.pointId);
  const current=data.events.find(e=>e.id===event.id);
  const stale=current?.version!==shown.version;
  const submit=async e=>{
    e.preventDefault();setBusy(true);setError('');
    try{await api.review({eventId:shown.id,version:shown.version,decision,reason,operationId:crypto.randomUUID()});const next=await api.load();setShown(structuredClone(next.events.find(e=>e.id===shown.id)));setReason('');onChanged();notify('复核结论已保存至演示记录');}
    catch(err){setError(err.message);}finally{setBusy(false);}
  };
  const createCase=async()=>{setBusy(true);try{const result=await api.createCase(shown.id);const next=await api.load();setShown(structuredClone(next.events.find(e=>e.id===shown.id)));await onChanged();notify(`已关联病例 ${result.id}`);}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Modal title={`${shown.id} · ${point?.name}异常事件`} onClose={onClose} wide>
    <div className="detail-top"><Badge status={shown.status}/><span>发生于 {date(shown.createdAt)}</span><span>原始证据已固定</span></div>
    {stale&&<div className="notice orange">事件已有新版本。请先刷新详情再提交。<button className="text-button" onClick={()=>{setShown(structuredClone(current));setError('');}}>刷新详情</button></div>}
    <div className="detail-grid"><section><h3>原始巡检证据</h3><img className="evidence-image" src={shown.snapshot.url} alt={`${point?.name}事件原始截图（演示）`}/><div className="timestamps"><span>采集时间<strong>{date(shown.snapshot.capturedAt)}</strong></span><span>分析完成<strong>{time(shown.snapshot.analyzedAt)}</strong></span></div>
      <h3>辅助研判</h3><p>{shown.finding}</p><h4>还需补充</h4>{shown.gaps.length?<ul>{shown.gaps.map(g=><li key={g}>{g}</li>)}</ul>:<p>暂无待补充项。</p>}
      <p className="muted">示例图片不构成病害证据。当前未接入真实模型或知识库。</p>
      <h3>协作记录</h3><div className="mini-steps">{ROLES.map((r,i)=><span key={r}><Check size={15}/>{r}{i<3&&<CaretRight size={14}/>}</span>)}</div><p className="muted">以上为演示步骤，不代表实际调用。</p>
      {!!shown.additionalEvidence?.length&&<p>追加证据：{shown.additionalEvidence.length} 张。原始审核截图未被替换。</p>}
    </section><section className="review-panel"><h3>人工复核</h3><p className="muted">结合原始证据填写结论，模型任务完成不自动关闭事件。</p>
      {shown.status==='closed'?<div className="notice green"><ShieldCheck size={20}/>该事件已关闭，可查看历史记录。</div>:<form onSubmit={submit}>
        <label>审核结论<select value={decision} onChange={e=>setDecision(e.target.value)}>{Object.entries(DECISIONS).filter(([key])=>key!=='close'||shown.status==='observing').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>审核依据<textarea required maxLength={1000} rows={5} value={reason} onChange={e=>setReason(e.target.value)} placeholder="描述你核对过的证据和判断依据…"/></label>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <button className="primary full" disabled={busy||stale} type="submit">{busy?<CircleNotch className="spin"/>:<Check/>}保存复核结论</button>
      </form>}
      <button className="secondary full case-action" disabled={busy||!!current?.caseId} onClick={createCase}>{current?.caseId?`已关联 ${current.caseId}`:'关联为跟踪病例'}</button>
      <h3>审核历史</h3>{shown.reviews.length?<div className="review-history">{[...shown.reviews].reverse().map(r=><article key={r.id}><strong>{DECISIONS[r.decision]}</strong><small>{date(r.at)} · {r.operator}</small><p>{r.reason}</p></article>)}</div>:<p className="muted">尚无人工复核记录</p>}
    </section></div>
  </Modal>;
}

function PlanEditor({plan,point,onClose,onSave}) {
  const [interval,setInterval]=useState(plan.interval);const [enabled,setEnabled]=useState(plan.enabled);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  return <Modal title={`编辑巡检计划 · ${point.name}`} onClose={onClose}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave(plan.id,{interval:Number(interval),enabled});onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}}>
    <label>抽帧间隔（秒）<input type="number" min="10" max="86400" step="1" required value={interval} onChange={e=>setInterval(e.target.value)}/></label>
    <p className="muted">这是可配置的演示间隔，不代表模型能在该时间内完成分析。</p>
    <label className="checkbox"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用此监控点计划</label>
    {error&&<p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={busy}>保存计划</button></div>
  </form></Modal>;
}

export default function App() {
  const [cameraDraft,setCameraDraft]=useState(null);
  const [cameraRecords,setCameraRecords]=useState([]),[cameraAuditError,setCameraAuditError]=useState('');
  const [data,setData]=useState(null);const [loadError,setLoadError]=useState('');const [route,setRoute]=useState(initialRoute);
  const [selected,setSelected]=useState('pond-3');const [now,setNow]=useState(Date.now());const [filter,setFilter]=useState('open');const [query,setQuery]=useState('');
  const [event,setEvent]=useState(null);const [planEdit,setPlanEdit]=useState(null);const [history,setHistory]=useState(false);const [runDetail,setRunDetail]=useState(null);
  const [outcome,setOutcome]=useState('uncertain');const [auto,setAuto]=useState(false);const [menu,setMenu]=useState(false);const [toast,setToast]=useState('');const [overrides,setOverrides]=useState({});
  const [followup,setFollowup]=useState(null);const [notificationOpen,setNotificationOpen]=useState(false);const [mediaError,setMediaError]=useState(false);
  const [playing,setPlaying]=useState(false);const [videoSeconds,setVideoSeconds]=useState(0);
  const video=useRef(null);const refreshSeq=useRef(0);const toastTimer=useRef(null);const autoPending=useRef(new Set());const fileUrls=useRef([]);
  const notify=useCallback(message=>{clearTimeout(toastTimer.current);setToast(message);toastTimer.current=setTimeout(()=>setToast(''),4000);},[]);
  const refresh=useCallback(async()=>{const seq=++refreshSeq.current;try{const next=await api.load();if(seq===refreshSeq.current){setData(next);setLoadError('');}}catch(e){if(seq===refreshSeq.current)setLoadError(e.message);}},[]);
  const refreshCameraAudit=useCallback(async()=>{try{const response=await agentRequest('/camera/audit');setCameraRecords(response.records||[]);setCameraAuditError('');}catch(e){setCameraAuditError(e.message);}},[]);
  const go=(next,tab)=>{location.hash=next;setRoute(next);setMenu(false);if(tab)setFilter(tab);else if(next==='dashboard'){setFilter('open');setQuery('');}};
  useEffect(()=>{refresh();const off=api.subscribe(refresh);const timer=setInterval(()=>setNow(Date.now()),1000);const poll=api.mode==='api'?setInterval(refresh,5000):null;const hash=()=>setRoute(initialRoute());window.addEventListener('hashchange',hash);return()=>{off();clearInterval(timer);clearInterval(poll);clearTimeout(toastTimer.current);window.removeEventListener('hashchange',hash);fileUrls.current.forEach(URL.revokeObjectURL);};},[refresh]);
  useEffect(()=>{refreshCameraAudit();const poll=setInterval(refreshCameraAudit,5000);window.addEventListener('fish-event-updated',refreshCameraAudit);return()=>{clearInterval(poll);window.removeEventListener('fish-event-updated',refreshCameraAudit);};},[refreshCameraAudit]);
  useEffect(()=>{setMediaError(false);setPlaying(false);setVideoSeconds(0);},[selected,overrides]);
  useEffect(()=>{
    if(!auto||!data||api.mode!=='demo')return;
    for(const plan of data.plans)if(plan.enabled&&Date.parse(plan.nextRunAt)<=now&&!autoPending.current.has(plan.id)&&data.points.find(p=>p.id===plan.pointId)?.deviceStatus==='online'&&!data.runs.some(r=>r.pointId===plan.pointId&&r.status==='running')){
      autoPending.current.add(plan.id);api.inspect(plan.pointId,outcome).catch(()=>{}).finally(()=>{setTimeout(()=>autoPending.current.delete(plan.id),1000);});
    }
  },[auto,now,data,outcome]);
  async function action(fn,success) {try{await fn();await refresh();if(success)notify(success);}catch(e){notify(e.message);}}
  async function inspect(pointId=selected) {
    let snapshot=null;
    if(pointId===selected&&video.current?.readyState>=2&&!mediaError){try{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=Math.round(640*video.current.videoHeight/video.current.videoWidth);canvas.getContext('2d').drawImage(video.current,0,0,canvas.width,canvas.height);snapshot=canvas.toDataURL('image/jpeg',.65);}catch{notify('无法截取该视频画面，将使用示例截图。');}}
    await action(()=>api.inspect(pointId,outcome,snapshot),'巡检演示已开始，可在 Agent 任务中查看进度');
  }
  function downloadRecords() {const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`fool-fish-demo-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('演示记录已导出');}
  function uploadVideo(e){const f=e.target.files?.[0];if(!f)return;if(f.size>200*1024*1024){notify('请选择小于 200 MB 的本地视频。');return;}const url=URL.createObjectURL(f);fileUrls.current.push(url);setOverrides(prev=>({...prev,[selected]:{url,name:f.name}}));notify('已载入本地视频，仅在当前浏览器会话内使用');}
  const active=NAV.find(n=>n[0]===route)||NAV[0];
  if(!data)return <div className="loading"><img src="/assets/brand-mark.svg" alt=""/><h1>fool fish</h1>{loadError?<><p role="alert">{loadError}</p><p>真实服务不可用时不会切回演示结果。</p><button onClick={refresh}>重试连接</button></>:<><CircleNotch className="spin" size={30}/><p>正在加载巡检工作台…</p></>}</div>;
  const point=data.points.find(p=>p.id===selected)||data.points[0];
  const mediaSource=overrides[point.id]?.url||(api.mode==='demo'?null:point.streamUrl);
  const selectedPlan=data.plans.find(p=>p.pointId===point.id);
  const selectedEvent=data.events.find(e=>e.pointId===point.id&&e.status!=='closed');
  const running=data.runs.filter(r=>r.status==='running');const failed=data.runs.filter(r=>r.status==='failed');const pending=data.events.filter(e=>e.status==='pending_review');
  const cameraReview=cameraRecords.filter(r=>r.eventNeedsAttention&&r.status==='succeeded');const cameraFailed=cameraRecords.filter(r=>r.eventNeedsAttention&&['failed','cancelled'].includes(r.status));
  const activeRun=running.find(r=>r.pointId===point.id);
  const filtered=data.events.filter(e=>(filter==='all'||filter==='open'&&e.status!=='closed'||e.status===filter)&&(!query||`${e.id} ${e.title} ${data.points.find(p=>p.id===e.pointId)?.name}`.includes(query)));
  const tabs=[['open','未关闭'],['pending_review','待人工复核'],['needs_evidence','等待补充'],['observing','观察中'],['closed','已关闭'],['all','全部']];
  return <div className="app-shell">
    <aside className={`sidebar ${menu?'open':''}`}><a className="brand" href="#dashboard"><span className="brand-mark" aria-hidden="true"><FishSimple size={35} weight="regular"/></span><span>fool fish<small>鱼类观察 · 巡检与记录</small></span></a>
      <div className="nav-caption">工作空间</div><nav aria-label="主导航">{NAV.map(([key,label,Icon])=><button key={key} className={`nav-item ${route===key?'active':''}`} onClick={()=>go(key)} aria-current={route===key?'page':undefined}><Icon size={23} weight={route===key?'fill':'regular'}/><span>{label}</span>{key==='audit'&&cameraReview.length+cameraFailed.length>0&&<b>{cameraReview.length+cameraFailed.length}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="avatar">运</div><span>演示运营者<small>本地演示工作区</small></span><CaretRight size={16}/></div>
    </aside>
    {menu&&<button className="mobile-shade" aria-label="收起导航" onClick={()=>setMenu(false)}/>}
    <div className="workspace"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="展开导航" onClick={()=>setMenu(!menu)}><List size={24}/></button><span className="site-label">场区：示范养殖区</span><span className={`mode-badge ${api.mode==='demo'?'':'real'}`}>{api.mode==='demo'?((['agents','cases','dashboard','audit','events'].includes(route))?'本地工作区':route==='settings'?'真实接入 / 演示业务':'演示数据'):'接口模式'}</span></div><div className="topbar-right"><span className="clock">{date(now)}</span><button className="icon-button bell" aria-label="查看待办通知" onClick={()=>setNotificationOpen(true)}><Bell size={23}/>{cameraReview.length+cameraFailed.length>0&&<i/>}</button></div></header>
    <main>
      {data.warning&&<div className="notice orange" role="alert">{data.warning}<button className="text-button" onClick={downloadRecords}>导出当前记录</button></div>}
      {loadError&&<div className="notice red" role="alert">更新失败：{loadError}。当前显示上次数据。<button onClick={refresh}>重试</button></div>}
      <div className="page-heading"><div><h1>{active[1]}</h1>{route!=='agents'&&<p>{({dashboard:'按计划检查画面，及时处理异常',plans:'让每个监控点都有清晰的巡检安排',events:'从异常发现到人工复核，完整记录每一步',audit:'查看每张摄像头截图的分析与核对记录',cases:'记录观察、复查与结案',settings:'管理接入配置与运行边界'})[route]}</p>}</div><div className="heading-actions">{['dashboard','agents','audit','cases','events'].includes(route)?null:<button className="secondary" onClick={downloadRecords}><DownloadSimple size={18}/>导出演示记录</button>}</div></div>
      {route==='dashboard'&&<><CameraPanel onAnalyze={shot=>{setCameraDraft(shot);go('agents');}}/><CameraAudit records={cameraRecords} error={cameraAuditError} compact onRefresh={refreshCameraAudit}/><details className="demo-history"><summary>演示巡检工作区（模拟数据）</summary><button className="secondary" disabled={!!activeRun||point.deviceStatus==='offline'} onClick={()=>inspect()}>执行演示巡检</button>
        <section className="stats" aria-label="巡检概览"><div><span>启用巡检</span><strong className="teal">{data.plans.filter(p=>p.enabled).length}<em> / {data.points.length}</em></strong></div><button onClick={()=>go('agents')}><span>正在分析</span><strong className="amber">{running.length}</strong></button><div><span>演示待复核</span><strong className="amber">{pending.length}</strong></div><button onClick={()=>go('agents')}><span>失败待处理</span><strong className="danger">{failed.length}</strong></button></section>
        <section className="monitor-section"><div className="monitor-selector"><label htmlFor="monitor-select">监控点</label><select id="monitor-select" value={point.id} onChange={e=>setSelected(e.target.value)}>{data.points.map(p=><option key={p.id} value={p.id}>{p.name} · {p.camera}{p.deviceStatus==='offline'?'（离线）':''}</option>)}</select><span className="muted point-type">{point.species} · 定时抽帧</span></div>
        <div className="media-grid"><article className="media-panel"><header><h2>巡检画面</h2><Badge tone="blue">{overrides[point.id]?'本地视频':mediaSource?'接口视频':'合成静态示意'}</Badge><label className="icon-button upload-label" title="载入本地视频"><UploadSimple size={19}/><span className="sr-only">载入本地视频</span><input type="file" accept="video/mp4,video/webm,video/ogg" onChange={uploadVideo}/></label></header>
          <div className="media-wrap">{point.deviceStatus==='offline'?<div className="media-unavailable"><VideoCamera size={36}/><strong>摄像头离线</strong><span>暂无可播放画面</span></div>:!mediaSource?<div className="media-static"><img src={ASSET} alt="合成池塘示意图，不是真实摄像头画面"/><div className="media-static-caption"><strong>合成静态示意</strong><span>未接入视频，可载入自己的本地文件</span></div></div>:<><video key={`${point.id}-${mediaSource}`} ref={video} src={mediaSource} poster={ASSET} autoPlay muted loop playsInline onError={()=>setMediaError(true)} onPlaying={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onTimeUpdate={e=>setVideoSeconds(e.currentTarget.currentTime)}/>{mediaError&&<div className="media-unavailable overlay"><Warning size={32}/><strong>视频暂时无法播放</strong><span>可以重新载入本地视频</span></div>}<div className="video-controls"><button aria-label={playing?'暂停视频':'播放视频'} onClick={()=>{if(video.current?.paused)video.current.play().catch(()=>notify('请手动点击视频播放'));else video.current?.pause();}}>{playing?<Pause size={17}/>:<Play size={17}/>}</button><span>{overrides[point.id]?'本地文件播放':'接口视频播放'} · {Math.floor(videoSeconds)}s</span><button aria-label="视频全屏" onClick={()=>video.current?.requestFullscreen?.().catch(()=>notify('当前浏览器不支持全屏'))}><ArrowsOut size={20}/></button></div></>}</div>
          <footer className="live-footer"><span><i className={`dot ${playing?'green':'gray'}`}/>{point.deviceStatus==='offline'?'未连接':!mediaSource?'静态示意':playing?'播放中':'已暂停'}</span><span className="muted">{overrides[point.id]?'本地文件，非摄像头直播':mediaSource?'接口提供的视频':'合成图形，不构成鱼病证据'}</span></footer>
        </article><article className="media-panel"><header><h2>最近巡检截图</h2><button className="text-button history-link" onClick={()=>setHistory(true)}>历史截图<CaretRight size={15}/></button></header><div className="media-wrap"><img src={point.snapshot.url} alt={`${point.name}最近巡检截图（演示）`}/><span className="image-label">演示截图</span></div><div className="timestamps"><span>采集时间<strong>{time(point.snapshot.capturedAt)}</strong></span><span>分析完成<strong>{time(point.snapshot.analyzedAt)}</strong></span></div><div className={`analysis-result ${activeRun?'blue':selectedEvent?'orange':'green'}`}><span>{activeRun?<CircleNotch className="spin" size={21}/>:selectedEvent?<Warning size={21} weight="fill"/>:<Check size={21}/>} {activeRun?'正在执行巡检演示':selectedEvent?'需跟踪 · 查看事件证据':'本次未发现可见异常（演示）'}</span><button className="text-button" onClick={()=>selectedEvent?setEvent(structuredClone(selectedEvent)):go('agents')}>查看分析<ArrowRight size={16}/></button></div></article></div></section>
        <section className="panel event-panel"><div className="panel-heading"><h2>事件中心</h2><div className="tabs">{tabs.filter(t=>['open','pending_review','observing','closed'].includes(t[0])).map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div></div><EventTable events={filtered.slice(0,3)} points={data.points} onOpen={e=>setEvent(structuredClone(e))}/><div className="system-footer"><span><Clock size={18}/>{api.mode==='demo'&&!auto?'页面自动演示未开启':selectedPlan.enabled?`下次计划 ${time(selectedPlan.nextRunAt)}`:'计划已暂停'}</span><span>分析中 {running.length} 项</span><span className={failed.length?'danger':''}>{failed.length>0&&<Warning size={17}/>}失败 {failed.length} 项</span><button className="text-button push-right" onClick={()=>go('agents')}>查看任务<CaretRight size={14}/></button></div></section>
      </details></>}
      {route==='events'&&<AgentConsole view="review"/>}
      {route==='plans'&&<><div className="notice blue"><CalendarDots size={22}/><div><strong>演示计划保存在此浏览器</strong><p>自动巡检仅在此页面打开且开关开启时执行。实际全天运行需要后台持久化调度。</p></div><label className="switch-label"><input type="checkbox" checked={auto} disabled={api.mode!=='demo'} onChange={e=>setAuto(e.target.checked)}/>开启页面内自动演示</label></div><section className="panel table-scroll"><table><thead><tr><th>监控点</th><th>执行间隔</th><th>计划状态</th><th>下次计划</th><th>操作</th></tr></thead><tbody>{data.plans.map(p=>{const mp=data.points.find(m=>m.id===p.pointId);return <tr key={p.id}><td><strong>{mp.name}</strong><small>{mp.camera}</small></td><td>{p.interval} 秒</td><td><Badge tone={p.enabled?'green':'gray'}>{p.enabled?'已启用':'已暂停'}</Badge></td><td className="numeric">{p.enabled?date(p.nextRunAt):'—'}</td><td><div className="row-actions"><button className="text-button" onClick={()=>setPlanEdit(p)}>编辑计划</button><button className="text-button" disabled={!p.enabled||mp.deviceStatus==='offline'||running.some(r=>r.pointId===p.pointId)} onClick={()=>inspect(p.pointId)}>执行一次</button></div></td></tr>;})}</tbody></table></section></>}
      {route==='agents'&&<><AgentConsole initialCapture={cameraDraft} onCaptureConsumed={()=>setCameraDraft(null)}/><details className="demo-history"><summary>历史演示任务（模拟数据）</summary><div className="notice blue"><Robot size={23}/><div><strong>多 Agent 流程演示</strong><p>当前步骤由前端模拟，未调用模型或知识库。任务状态与事件处理状态独立。</p></div></div><section className="panel table-scroll"><table><thead><tr><th>任务</th><th>监控点</th><th>执行状态</th><th>协作进度</th><th>操作</th></tr></thead><tbody>{data.runs.map(r=><tr key={r.id}><td>{r.id}<small>{date(r.createdAt)}</small></td><td>{data.points.find(p=>p.id===r.pointId)?.name}</td><td><Badge task status={r.status}/>{r.error&&<small className="danger">{r.error}</small>}</td><td><div className="step-dots">{r.steps.map((s,i)=><span key={i} className={s} title={`${ROLES[i]}：${TASK_STATUS[s]?.[0]}`}>{i+1}</span>)}</div></td><td><div className="row-actions"><button className="text-button" onClick={()=>setRunDetail(r.id)}>详情</button>{r.status==='failed'&&<button className="text-button" disabled={r.attempt>=3} onClick={()=>action(()=>api.retry(r.id),'已创建重试任务')}>重试</button>}{r.status==='running'&&<button className="text-button danger" onClick={()=>action(()=>api.cancel(r.id),'已取消演示任务')}>取消</button>}</div></td></tr>)}</tbody></table></section></details></>}
      {route==='cases'&&<><Suspense fallback={<p>正在打开病例…</p>}><CaseConsole/></Suspense><details className="demo-history"><summary>历史演示病例（模拟数据）</summary><div className="notice blue"><FileText size={22}/><span>先在事件中心完成复核，再关联为病例。复查计划仅保存记录，真实通知服务尚未接入。</span></div>{data.cases.length?<div className="case-grid">{data.cases.map(c=><article className="panel case-card" key={c.id}><div className="panel-heading"><h2>{c.title}</h2><Badge status={c.status}/></div><p className="muted">{c.id} · {data.points.find(p=>p.id===c.pointId)?.name}</p><h4>关联事件</h4><div className="row-actions">{c.eventIds.map(id=><button className="text-button" key={id} onClick={()=>{const e=data.events.find(e=>e.id===id);if(e)setEvent(structuredClone(e));}}>{id}<CaretRight/></button>)}</div><h4>复查记录</h4>{c.followups.length?c.followups.map(f=><div key={f.id} className="followup-row"><Clock size={18}/><span>{date(f.at)}<small>{f.note}</small></span><Badge tone="gray">仅记录</Badge></div>):<p className="muted">尚未安排复查</p>}<button className="secondary" onClick={()=>setFollowup(c.id)}><CalendarDots size={18}/>添加复查计划</button></article>)}</div>:<Empty title="暂无病例" text="完成事件复核后，可将需要跟踪的事件关联为病例。"/>}</details></>}
      {route==='settings'&&<><AgentConsole view="settings"/><div className="settings-grid"><section className="panel settings-panel"><h2>运行模式</h2><div className="setting-row"><span>数据来源</span><Badge tone="orange">{api.mode==='demo'?'浏览器演示数据':'远程接口'}</Badge></div><div className="setting-row"><span>视觉模型</span><Badge tone="gray">以上方真实接入状态为准</Badge></div><div className="setting-row"><span>本机摄像头</span><a href="#dashboard">前往工作台连接</a></div><p className="muted">真实连接需通过服务端配置。请勿在前端填写模型密钥或摄像头密码。</p><h3>演示场景</h3><label>新巡检的模拟结果<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="uncertain">证据不足 → 进入事件中心</option><option value="normal">未发现可见异常</option><option value="failure">云端超时 → 任务失败</option></select></label><p className="muted">切换场景仅影响新任务，不会修改历史结果。</p><button className="secondary" onClick={downloadRecords}><DownloadSimple size={18}/>导出演示记录</button></section><section className="panel settings-panel"><h2>监控点接入</h2>{data.points.map(p=><div className="setting-row" key={p.id}><div>{p.name}<small>{p.camera} · 示例设备</small></div><Badge tone={p.deviceStatus==='online'?'blue':'gray'}>{p.deviceStatus==='online'?'演示在线':'演示离线'}</Badge></div>)}<h3>当前保护措施</h3><ul className="plain-list"><li>每个监控点同时仅运行一个演示任务</li><li>总并发上限 2，重试最多 3 次</li><li>审核时检查事件版本，固定原始截图</li><li>真实接口错误不会伪装成演示成功</li></ul><p className="muted">浏览器校验不替代服务端权限与安全控制。</p></section><section className="panel settings-panel audit-panel"><h2>操作记录</h2>{data.audit.length?<div className="table-scroll"><table><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>内容</th></tr></thead><tbody>{data.audit.slice(0,30).map(a=><tr key={a.id}><td>{date(a.at)}</td><td>{a.action}</td><td>{a.target}</td><td>{a.detail}</td></tr>)}</tbody></table></div>:<Empty title="暂无操作记录" text="修改计划或提交复核后会在这里留下演示记录。"/>}</section></div></>}
      {route==='audit'&&<CameraAudit records={cameraRecords} error={cameraAuditError} onRefresh={refreshCameraAudit}/>}
    </main><footer className="workspace-footer">fool fish · 定时巡检工作台{!['agents','audit','cases'].includes(route)&&<span>{api.mode==='demo'?'演示记录已单独标注':'接口模式'}</span>}</footer></div>
    {toast&&<div className="toast" role="status"><Check size={18}/>{toast}</div>}
    {event&&<EventDetail key={event.id} event={event} data={data} onClose={()=>setEvent(null)} onChanged={refresh} notify={notify}/>}
    {planEdit&&<PlanEditor plan={planEdit} point={data.points.find(p=>p.id===planEdit.pointId)} onClose={()=>setPlanEdit(null)} onSave={async(id,p)=>{await api.updatePlan(id,p);await refresh();notify('巡检计划已保存');}}/>}
    {history&&<Modal title={`${point.name} · 巡检截图`} onClose={()=>setHistory(false)}><p className="muted">点击事件可查看当时的固定证据。示例素材不代表真实鱼体状况。</p><img className="evidence-image" src={point.snapshot.url} alt="最近巡检截图"/><div className="timestamps"><span>最近采集<strong>{date(point.snapshot.capturedAt)}</strong></span><span>分析完成<strong>{time(point.snapshot.analyzedAt)}</strong></span></div><h3>关联事件截图</h3>{data.events.filter(e=>e.pointId===point.id).map(e=><button className="history-event" key={e.id} onClick={()=>{setHistory(false);setEvent(structuredClone(e));}}><img src={e.snapshot.url} alt=""/><span>{e.title}<small>{date(e.snapshot.capturedAt)}</small></span><CaretRight/></button>)}</Modal>}
    {runDetail&&(()=>{const r=data.runs.find(r=>r.id===runDetail);return <Modal title={`Agent 任务 · ${r.id}`} onClose={()=>setRunDetail(null)}><div className="detail-top"><Badge task status={r.status}/><span>尝试次数 {r.attempt} / 3</span></div><p className="muted">这是前端模拟执行记录，没有真实模型调用。</p><div className="timeline">{ROLES.map((role,i)=><div className="timeline-item" key={role}><span className={`step-number ${r.steps[i]}`}>{i+1}</span><div><h3>{role}</h3><p>{['检查采集图像并记录可见信息','根据证据选择后续处理分支','查阅知识和历史记录（尚未接入）','整理事件摘要，不自动确诊或结案'][i]}</p></div><Badge task status={r.steps[i]}/></div>)}</div>{r.error&&<div className="notice red">{r.error}</div>}{r.eventId&&<button className="primary" onClick={()=>{const e=data.events.find(e=>e.id===r.eventId);setRunDetail(null);if(e)setEvent(structuredClone(e));}}>查看关联事件<ArrowRight/></button>}</Modal>;})()}
    {notificationOpen&&<Modal title="待办通知" onClose={()=>setNotificationOpen(false)}><div className="notice orange">真实摄像头任务：{cameraReview.length} 项核对与结束待办，{cameraFailed.length} 项异常待处理。</div>{cameraAuditError&&<p className="muted">摄像头任务状态暂时无法更新：{cameraAuditError}</p>}{[...cameraReview,...cameraFailed].slice(0,8).map(record=><button className="history-event" key={record.id} onClick={()=>{setNotificationOpen(false);location.hash=`agents?job=${record.id}`;setRoute('agents');}}><Warning size={22}/><span>{record.scope} · {EVENT_LABELS[record.eventState]}<small>{date(record.capture.capturedAt)}</small></span><CaretRight/></button>)}<button className="history-event" onClick={()=>{setNotificationOpen(false);go('audit');}}><FileText size={23}/><span>查看图像审计</span><CaretRight/></button></Modal>}
    {followup&&<FollowupDialog onClose={()=>setFollowup(null)} onSave={async input=>{await api.followup(followup,input);await refresh();notify('复查计划已记录，尚未接入提醒服务');setFollowup(null);}}/>}
  </div>;
}
function FollowupDialog({onClose,onSave}) {
  const [at,setAt]=useState('');const [note,setNote]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  return <Modal title="添加复查计划" onClose={onClose}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave({at,note});}catch(e){setError(e.message);}finally{setBusy(false);}}}><label>复查时间<input type="datetime-local" required value={at} onChange={e=>setAt(e.target.value)}/></label><label>复查内容<textarea required maxLength={1000} rows={4} value={note} onChange={e=>setNote(e.target.value)} placeholder="例如补拍同一部位、记录进食变化…"/></label><p className="muted">本版仅保存计划记录，不会在后台发送提醒。</p>{error&&<p className="form-error" role="alert">{error}</p>}<button disabled={busy} className="primary full">保存复查计划</button></form></Modal>;
}
