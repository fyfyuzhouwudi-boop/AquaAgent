import React,{useEffect,useRef,useState} from 'react';
import {CameraSession,preferredCamera,cameraError,captureFrame} from './camera.js';
import {agentRequest} from './agent-api.js';
import {CameraAutoAnalyzer} from './camera-auto.js';
import './camera.css';

export default function CameraPanel({onAnalyze}){
  const [devices,setDevices]=useState([]),[selected,setSelected]=useState(''),[connected,setConnected]=useState(null),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[shot,setShot]=useState(null),[scope,setScope]=useState('鱼缸01'),[automatic,setAutomatic]=useState(false),[autoAnalysis,setAutoAnalysis]=useState(false),[interval,setIntervalSeconds]=useState(60),[count,setCount]=useState(0),[autoCount,setAutoCount]=useState(0),[autoMessage,setAutoMessage]=useState('');
  const video=useRef(null),session=useRef(null),active=useRef(false),generation=useRef(0),refreshGeneration=useRef(0),autoAnalyzer=useRef(null);
  autoAnalyzer.current??=new CameraAutoAnalyzer({request:agentRequest,onSubmitted:(count,id)=>{setAutoCount(count);setAutoMessage(`已提交第 ${count} 张抽帧分析，任务 ${id.slice(0,8)}。结果会进入图像审计与站内通知。`);},onStop:message=>{setAutoAnalysis(false);setAutoMessage(message);}});
  async function refresh(){const turn=++refreshGeneration.current;try{if(!navigator.mediaDevices?.enumerateDevices)throw new Error('当前浏览器不支持摄像头，请在 Edge 或 Chrome 打开 http://127.0.0.1:4173/。');const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');if(active.current&&turn===refreshGeneration.current){setDevices(list);setSelected(old=>list.some(d=>d.deviceId===old)?old:preferredCamera(list)?.deviceId||'');}return list;}catch(e){if(active.current)setError(cameraError(e));return [];}}
  function disconnect(){generation.current++;autoAnalyzer.current.stop();session.current?.stop();if(video.current)video.current.srcObject=null;setConnected(null);setReady(false);setAutomatic(false);setAutoAnalysis(false);setBusy(false);}
  useEffect(()=>{active.current=true;session.current=new CameraSession(navigator.mediaDevices);refresh();const change=()=>refresh();navigator.mediaDevices?.addEventListener('devicechange',change);return()=>{active.current=false;generation.current++;refreshGeneration.current++;autoAnalyzer.current.stop();session.current?.stop();navigator.mediaDevices?.removeEventListener('devicechange',change);};},[]);
  async function connect(){
    disconnect();setBusy(true);setError('');setShot(null);setCount(0);setAutoCount(0);setAutoMessage('');autoAnalyzer.current.reset();const turn=generation.current;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器不支持摄像头，请在 Edge 或 Chrome 打开本平台。');
      let stream=await session.current.open(selected||undefined);if(!active.current||turn!==generation.current||!stream)return;
      // Permission reveals device labels; prefer the external C920 on first use.
      const list=await refresh();if(!active.current||turn!==generation.current)return;
      const preferred=!devices.some(d=>d.label)?preferredCamera(list):null;
      if(preferred?.deviceId&&stream.getVideoTracks()[0]?.getSettings().deviceId!==preferred.deviceId){stream=await session.current.open(preferred.deviceId);if(!active.current||turn!==generation.current||!stream)return;}
      const track=stream.getVideoTracks()[0];if(!track)throw new Error('摄像头没有返回视频轨道。');
      const settings=track.getSettings();setSelected(settings.deviceId||selected);setConnected({name:track.label||'本机摄像头',width:settings.width,height:settings.height});
      track.addEventListener('ended',()=>{if(active.current&&turn===generation.current){disconnect();setError('摄像头连接已中断，请检查设备后重新连接。');}});
      video.current.srcObject=stream;await video.current.play();
    }catch(e){if(active.current&&turn===generation.current){disconnect();setError(cameraError(e));}}
    finally{if(active.current&&turn===generation.current)setBusy(false);}
  }
  function capture(){try{const frame={...captureFrame(video.current),id:crypto.randomUUID(),camera:connected?.name||'本机摄像头',scope:scope.trim()||'鱼缸01'};setShot(frame);setCount(n=>n+1);setError('');return frame;}catch(e){setError(e.message);setAutomatic(false);setAutoAnalysis(false);return null;}}
  useEffect(()=>{if(autoAnalysis&&automatic&&ready)autoAnalyzer.current.resume();else autoAnalyzer.current.stop();return()=>autoAnalyzer.current.stop();},[autoAnalysis,automatic,ready]);
  useEffect(()=>{if(!automatic||!ready)return;const timer=setInterval(()=>{if(document.visibilityState==='visible'){const frame=capture();if(frame&&autoAnalysis)void autoAnalyzer.current.submit(frame);}},Number(interval)*1000);return()=>clearInterval(timer);},[automatic,ready,interval,connected,scope,autoAnalysis]);
  return <section className="camera-panel panel" aria-label="本机摄像头">
    <header className="camera-heading"><div><h2>摄像头巡检</h2><span className={`badge ${ready?'green':'gray'}`}>{busy?'连接中':ready?'实时连接':'未连接'}</span></div><button className="text-button" disabled={busy} onClick={refresh}>刷新设备</button></header>
    <div className="camera-toolbar"><label>摄像头<select value={selected} disabled={busy||!!connected} onChange={e=>setSelected(e.target.value)}>{!devices.length&&<option value="">连接后检测设备</option>}{devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`摄像头 ${i+1}（连接后显示名称）`}</option>)}</select></label><label>观察对象<input value={scope} maxLength={80} onChange={e=>setScope(e.target.value)}/></label>{connected||busy?<button className="secondary" onClick={disconnect}>断开摄像头</button>:<button className="primary" onClick={connect}>连接摄像头</button>}</div>
    {error&&<p className="notice red" role="alert">{error}</p>}
    <div className="camera-media-grid"><article><header><h3>实时画面</h3><small>{connected?.name||'USB / 内置摄像头'}</small></header><div className="camera-view"><video ref={video} autoPlay muted playsInline onPlaying={()=>setReady(true)} onWaiting={()=>setReady(false)} onPause={()=>setReady(false)}/>{!ready&&<div className="camera-placeholder">{busy?'正在请求摄像头…':'连接摄像头后显示画面'}</div>}</div><footer><span>{ready?`${connected?.width} × ${connected?.height}`:'等待连接'}</span><button className="secondary" disabled={!ready} onClick={capture}>截取当前画面</button></footer></article>
    <article><header><h3>最近抽帧</h3><small>{shot?new Date(shot.capturedAt).toLocaleTimeString('zh-CN',{hour12:false}):'尚未采集'}</small></header><div className="camera-view">{shot?<img src={shot.image} alt="摄像头最近抽帧"/>:<div className="camera-placeholder">截图会显示在这里</div>}</div><footer><span>{shot?`${shot.scope} · ${shot.width} × ${shot.height} · 未分析`:'尚无截图'}</span><button className="primary" disabled={!shot} onClick={()=>onAnalyze(shot)}>交给 Agent 分析</button></footer></article></div>
    <div className="camera-schedule"><label className="checkbox"><input type="checkbox" checked={automatic} disabled={!ready} onChange={e=>{setAutomatic(e.target.checked);if(!e.target.checked)setAutoAnalysis(false);}}/>定时抽帧</label><label>间隔<select value={interval} disabled={automatic} onChange={e=>setIntervalSeconds(Number(e.target.value))}>{[10,30,60,120,300].map(n=><option key={n} value={n}>{n} 秒</option>)}</select></label><span>本次采集 {count} 张 · 仅保留最新一张</span></div>
    <div className="camera-auto-analysis"><label className="checkbox"><input type="checkbox" checked={autoAnalysis} disabled={!automatic||!ready||autoCount>=10} onChange={e=>{setAutoAnalysis(e.target.checked);setAutoMessage(e.target.checked?'已开启自动分析。下一次定时抽帧会提交模型任务。':'已关闭自动分析。');}}/>抽帧后自动交给 Agent 分析</label><span>会将截图发送到云端 Qwen / DeepSeek，可能产生费用；最多每 60 秒提交 1 张、单次连接最多 10 张。每张完成后由人工核对。</span><small>已自动提交 {autoCount} 张</small>{autoMessage&&<p role="status">{autoMessage}</p>}</div>
    <p className="camera-note">画面只在本机预览，不采集声音。当前页面可见时才会定时抽帧；仅开启“自动分析”后才会自动提交云端任务。历史提交图片保存在本机任务记录中。</p>
  </section>;
}
