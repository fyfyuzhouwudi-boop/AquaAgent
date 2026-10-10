import http from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Store} from './store.js';
import {AppError,readConfig,publicConfig,complete,endpoint} from './providers.js';
import {ROLES,validateJob,preflight,runJob} from './agents.js';
import {ragStatus,searchRag} from './rag.js';
import {prepareReviewFiles,persistReviewFiles,readReviewFile} from './review-files.js';
import {caseSummary,caseDetails,getCase,mutateCase,readCaseFile} from './cases.js';
import {cameraAudit} from './camera-audit.js';
import {eventFields,resolveEvent} from './event-lifecycle.js';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=8000;
const ALLOWED_HOSTS=new Set(['127.0.0.1:8000','localhost:8000','127.0.0.1:4173','localhost:4173']);
const ALLOWED_ORIGINS=new Set([...ALLOWED_HOSTS].map(h=>'http://'+h));
const validKey=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(value);
const same=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));

export function createApp({store=new Store(path.join(ROOT,'data/state.json')),configFile=path.join(ROOT,'.env'),configEnv=process.env,knowledgeFile=path.join(ROOT,'knowledge/documents.json'),call=complete}={}){
  const sessions=new Map();const controllers=new Map();let checking=0;
  const attachmentDirectory=path.join(path.dirname(store.file),'review-attachments');
  const config=()=>readConfig(configFile,{env:configEnv});
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
  async function body(req){
    if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError('需要 JSON 请求。','CONTENT_TYPE',415);
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>6*1024*1024)throw new AppError('请求过大，图片上限 4 MB。','TOO_LARGE',413);chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('JSON 格式错误。');}
  }
  const server=http.createServer(async(req,res)=>{
    try{
      if(!ALLOWED_HOSTS.has(req.headers.host)||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&!ALLOWED_ORIGINS.has(req.headers.origin)))throw new AppError('拒绝非本机平台来源。','FORBIDDEN',403);
      const url=new URL(req.url,'http://127.0.0.1:8000');const route=url.pathname;
      if(req.method==='GET'&&route==='/api/agents/health')return json(res,200,{service:'fool-fish-agents',version:1});
      const cookie=/(?:^|;\s*)ff_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];
      let session=sessions.get(cookie);
      if(session&&session.expires<Date.now()){sessions.delete(cookie);session=null;}
      if(req.method==='GET'&&route==='/api/agents/session'){
        if(!session){
          for(const [id,s] of sessions)if(s.expires<Date.now())sessions.delete(id);
          if(sessions.size>=100)throw new AppError('本地会话过多，请稍后再试。','RATE_LIMIT',429);
          const id=randomBytes(24).toString('hex');session={csrf:randomBytes(24).toString('hex'),expires:Date.now()+12*3600000};sessions.set(id,session);
          res.setHeader('Set-Cookie',`ff_session=${id}; HttpOnly; SameSite=Strict; Path=/api/agents; Max-Age=43200`);
        }
        return json(res,200,{csrf:session.csrf,mode:'local-single-user'});
      }
      if(!session)throw new AppError('本地会话已过期，请刷新页面。','UNAUTHORIZED',401);
      if(req.method!=='GET'&&!same(req.headers['x-csrf-token'],session.csrf))throw new AppError('请求校验失败，请刷新页面。','FORBIDDEN',403);
      if(req.method==='GET'&&route==='/api/agents/cases')return json(res,200,{cases:store.data.cases.map(caseSummary)});
      if(req.method==='POST'&&route==='/api/agents/cases')return json(res,200,mutateCase(store,'create',null,await body(req),req.headers['idempotency-key'],attachmentDirectory));
      const caseMatch=/^\/api\/agents\/cases\/([a-f0-9-]+)(?:\/(link|followup|close|reopen))?$/.exec(route);
      if(caseMatch){
        if(req.method==='GET'&&!caseMatch[2])return json(res,200,caseDetails(store,caseMatch[1]));
        if(req.method==='POST'&&caseMatch[2])return json(res,200,mutateCase(store,caseMatch[2],caseMatch[1],await body(req),req.headers['idempotency-key'],attachmentDirectory));
      }
      const caseFileMatch=/^\/api\/agents\/cases\/([a-f0-9-]+)\/attachments\/([a-f0-9-]{36})$/.exec(route);
      if(req.method==='GET'&&caseFileMatch){
        const {meta,bytes}=readCaseFile(attachmentDirectory,getCase(store,caseFileMatch[1]),caseFileMatch[2]);
        res.writeHead(200,{'Content-Type':meta.type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':`${meta.type.startsWith('image/')&&!url.searchParams.has('download')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name).replace(/'/g,'%27')}`});res.end(bytes);return;
      }
      const imageMatch=/^\/api\/agents\/jobs\/([a-f0-9-]+)\/image$/.exec(route);
      if(req.method==='GET'&&imageMatch){
        const j=store.data.jobs.find(j=>j.id===imageMatch[1]);const image=/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(j?.image||'');
        if(!image)throw new AppError('图片不存在。','NOT_FOUND',404);
        res.writeHead(200,{'Content-Type':image[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(Buffer.from(image[2],'base64'));return;
      }
      if(req.method==='GET'&&route==='/api/agents/providers')return json(res,200,{providers:publicConfig(config()),roles:ROLES,rag:ragStatus(config().rag)});
      if(req.method==='GET'&&route==='/api/agents/camera/audit')return json(res,200,{records:cameraAudit(store.data.jobs,store.data.audit,url.searchParams.get('limit'))});
      if(req.method==='GET'&&route==='/api/agents/jobs')return json(res,200,{jobs:store.data.jobs.slice(0,200).map(({image,fingerprint,operationId,...job})=>({...job,...eventFields(job)}))});
      if(req.method==='POST'&&route==='/api/agents/jobs'){
        const operationId=req.headers['idempotency-key'];if(!validKey(operationId))throw new AppError('缺少有效操作编号。');
        const input=validateJob(await body(req));const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const existing=store.data.jobs.find(j=>j.operationId===operationId);
        if(existing){if(existing.fingerprint!==fingerprint)throw new AppError('操作编号已用于不同请求。','CONFLICT',409);return json(res,200,{id:existing.id});}
        if(controllers.size+checking>=2)throw new AppError('同时最多执行两个模型任务，请等待完成。','BUSY',429);
        if(store.data.jobs.length>=200)throw new AppError('本地已保存 200 个真实任务，请先由维护者备份归档。','STORAGE_LIMIT',409);
        const providers=config();preflight(input,providers);
        const job={id:randomUUID(),operationId,fingerprint,...input,status:'queued',createdAt:new Date().toISOString(),version:1,steps:ROLES.map(r=>({id:r.id,name:r.name,provider:r.provider,status:'queued'})),sources:[],historyIds:[]};
        store.data.jobs.unshift(job);store.audit('task_created',job.id,`type=${job.type}; scope=${job.scope}; history=${job.includeHistory}`);
        const controller=new AbortController();controllers.set(job.id,controller);
        json(res,202,{id:job.id});
        void runJob(job,{store,config:providers,knowledgeFile,signal:controller.signal,call}).finally(()=>controllers.delete(job.id));return;
      }
      if(req.method==='POST'&&route==='/api/agents/test'){
        const input=await body(req);if(!['deepseek','qwen','rag'].includes(input.provider))throw new AppError('未知模型服务。');
        if(controllers.size+checking>=2)throw new AppError('有请求正在执行，请稍后测试。','BUSY',429);
        if(input.provider==='rag'){
          checking++;try{const sources=await searchRag(config().rag,'鱼体鳞片竖立的可见特征');store.audit('rag_test','coze-rag',`返回 ${sources.length} 条片段`);return json(res,200,{ok:true,message:`知识库连接成功，返回 ${sources.length} 条片段；不代表资料内容已核实。`});}finally{checking--;}
        }
        const provider=config()[input.provider];endpoint(provider);checking++;
        try{const result=await call(provider,[{role:'user',content:'Reply with OK only.'}],{maxTokens:64});store.audit('connection_test',input.provider,'文本请求成功；不代表图像识别能力已验收。');return json(res,200,{ok:true,model:result.model,message:'文本连接成功；图像能力仍需上传图片单独验证。'});}finally{checking--;}
      }
      const fileMatch=/^\/api\/agents\/jobs\/([a-f0-9-]+)\/attachments\/([a-f0-9-]{36})$/.exec(route);
      if(req.method==='GET'&&fileMatch){
        const job=store.data.jobs.find(j=>j.id===fileMatch[1]);if(!job)throw new AppError('任务不存在。','NOT_FOUND',404);
        const {meta,bytes}=readReviewFile(attachmentDirectory,job,fileMatch[2]);
        res.writeHead(200,{'Content-Type':meta.type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':`${meta.type.startsWith('image/')&&!url.searchParams.has('download')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name).replace(/'/g,'%27')}`});res.end(bytes);return;
      }
      const match=/^\/api\/agents\/jobs\/([a-f0-9-]+)(?:\/(cancel|review|resolve))?$/.exec(route);
      if(match){
        const job=store.data.jobs.find(j=>j.id===match[1]);if(!job)throw new AppError('任务不存在。','NOT_FOUND',404);
        if(req.method==='GET'&&!match[2]){const {fingerprint,operationId,...data}=job;return json(res,200,{...data,...eventFields(job)});}
        if(req.method==='POST'&&match[2]==='resolve')return json(res,200,resolveEvent(store,job,await body(req)));
        if(req.method==='POST'&&match[2]==='cancel'){
          if(!['queued','running'].includes(job.status))throw new AppError('任务已结束。','CONFLICT',409);
          job.status='cancelled';job.completedAt=new Date().toISOString();for(const s of job.steps)if(s.status==='running'||s.status==='queued')s.status='cancelled';controllers.get(job.id)?.abort();store.audit('task_cancelled',job.id,'已停止等待后续步骤；上游已受理请求仍可能计费。');return json(res,200,{ok:true});
        }
        if(req.method==='POST'&&match[2]==='review'){
          if(job.resolution?.status==='closed')throw new AppError('事件已结束，请先重新打开后再修改核对结论。','CONFLICT',409);
          const input=await body(req);
          if(job.status!=='succeeded'||(job.type!=='inspection'&&!['pending','reviewed'].includes(job.reviewStatus)))throw new AppError('仅可审核已完成且需要核对的分析任务。');
          if(input.version!==job.version)throw new AppError('记录已更新，请刷新后再审核。','CONFLICT',409);
          if(!['accepted','needs_evidence','rejected'].includes(input.decision)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw new AppError('请选择结论并填写 1 至 1000 字的审核依据。');
          const {retained,pending}=prepareReviewFiles(input,job);
          const rollbackFiles=persistReviewFiles(attachmentDirectory,pending);
          const previous={review:job.review,reviewHistory:job.reviewHistory,reviewStatus:job.reviewStatus,version:job.version};
          const auditLength=store.data.audit.length;
          try{
            job.reviewHistory=[...(job.reviewHistory||[]),...(job.review?[job.review]:[])];
            job.review={decision:input.decision,reason:input.reason.trim(),at:new Date().toISOString(),operator:'local-operator',attachments:[...retained,...pending.map(p=>p.meta)]};
            job.reviewStatus='reviewed';job.version++;
            store.audit('human_review',job.id,`${input.decision}; attachments=${job.review.attachments.length}`);
          }catch(error){Object.assign(job,previous);store.data.audit.splice(0,store.data.audit.length-auditLength);rollbackFiles();throw error;}
          return json(res,200,{ok:true});
        }
      }
      throw new AppError('接口不存在。','NOT_FOUND',404);
    }catch(e){
      if(!res.headersSent)json(res,e instanceof AppError?e.status:500,{code:e instanceof AppError?e.code:'INTERNAL',message:e instanceof AppError?e.message:'本地服务处理失败，原数据未被自动清空。'});
      else res.end();
    }
  });
  server.requestTimeout=100000;server.headersTimeout=10000;
  server.on('close',()=>{for(const c of controllers.values())c.abort();});
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  createApp().listen(PORT,'127.0.0.1',()=>console.log(`fool-fish-agents ready on http://127.0.0.1:${PORT}`));
}
