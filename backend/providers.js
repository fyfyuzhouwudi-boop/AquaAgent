import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';

export class AppError extends Error {
  constructor(message, code='VALIDATION', status=400) {super(message);this.code=code;this.status=status;}
}
function connectionError(error,signal,combined){
  if(signal?.aborted)return new AppError('任务已取消。','CANCELLED');
  if(error?.name==='TimeoutError'||combined.reason?.name==='TimeoutError')return new AppError('模型请求超过 90 秒，未取得完整响应。','UPSTREAM_TIMEOUT',502);
  const codes={ECONNRESET:'连接被重置',ENOTFOUND:'域名解析失败',EAI_AGAIN:'域名解析暂时失败',ECONNREFUSED:'连接被拒绝',UND_ERR_SOCKET:'连接中断',UND_ERR_CONNECT_TIMEOUT:'建立连接超时',ETIMEDOUT:'网络连接超时'};
  const reason=codes[error?.cause?.code]||codes[error?.code]||'网络请求中断';
  return new AppError(`模型接口${reason}，本次未取得完整响应。可测试连接后重新提交；请求不会自动重发。`,'UPSTREAM_CONNECTION',502);
}
export function readConfig(file,{env=process.env}={}) {
  let values={};
  try { values=parseEnv(readFileSync(file,'utf8').replace(/^\uFEFF/,'')); }
  catch(e) {if(e.code!=='ENOENT')throw new AppError('服务端配置文件无法读取。','CONFIG',503);}
  // An explicitly empty environment variable disables the corresponding file value.
  const value=name=>{const raw=env[name]!==undefined?env[name]:values[name];return typeof raw==='string'?raw.trim():'';};
  const config=Object.fromEntries(['deepseek','qwen'].map(id=>{
    const prefix=id.toUpperCase();
    return [id,{id,baseUrl:value(`${prefix}_BASE_URL`),model:value(`${prefix}_MODEL`),key:value(`${prefix}_API_KEY`)}];
  }));
  config.rag={url:value('RAG_SEARCH_URL'),allowedOrigin:value('RAG_ALLOWED_ORIGIN'),key:value('RAG_API_KEY')};
  return config;
}
export function endpoint(config) {
  if(!config?.key||!config.model||!config.baseUrl)throw new AppError('请先在 backend/.env 中填写该服务的地址、模型 ID 和密钥。','NOT_CONFIGURED',503);
  let url;
  try {url=new URL(config.baseUrl);} catch {throw new AppError('服务地址格式不正确。','CONFIG',503);}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new AppError('云端服务地址须为 HTTPS，不能包含账号、查询参数或密钥。','CONFIG',503);
  url.pathname=url.pathname.replace(/\/$/,'')+'/chat/completions';
  return url.href;
}
export function publicConfig(config) {
  return ['deepseek','qwen'].map(id=>config[id]).map(p=>{
    let configured=false;
    try{endpoint(p);configured=true;}catch{}
    let baseUrl='';try{const url=new URL(p.baseUrl);baseUrl=url.origin+url.pathname;}catch{}
    return {id:p.id,model:p.model,baseUrl,configured,keyPresent:!!p.key};
  });
}
export async function complete(config,messages,{signal,fetcher=fetch,maxTokens=1600,tools,toolChoice='auto'}={}) {
  const url=endpoint(config);
  const combined=AbortSignal.any([AbortSignal.timeout(90000),...(signal?[signal]:[])]);
  let response;
  try {
    response=await fetcher(url,{method:'POST',redirect:'error',signal:combined,
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.key}`},
      body:JSON.stringify({model:config.model,messages,stream:false,max_tokens:maxTokens,...(config.id==='deepseek'?{thinking:{type:'disabled'}}:{enable_thinking:false}),...(tools?{tools,tool_choice:toolChoice,parallel_tool_calls:false}:{})})});
  } catch(error) {
    throw connectionError(error,signal,combined);
  }
  if(!response.ok){
    const meaning={401:'密钥无效',402:'账户余额不足',403:'无模型访问权限',404:'模型或地址不存在',429:'请求限流'}[response.status]||'模型服务返回错误';
    // Never echo upstream bodies: they can contain submitted images, credentials or proxy diagnostics.
    throw new AppError(`${meaning}（HTTP ${response.status}）。`,'UPSTREAM_ERROR',502);
  }
  let data;
  try {data=await response.json();}catch(error){
    // Receiving headers is not completion: the body can still time out or disconnect.
    if(signal?.aborted||combined.aborted||!(error instanceof SyntaxError))throw connectionError(error,signal,combined);
    throw new AppError('模型服务返回的内容不是有效 JSON。','UPSTREAM_FORMAT',502);
  }
  const choice=data?.choices?.[0];
  if(choice?.finish_reason==='length')throw new AppError('模型输出达到长度上限，未将截断结果记作完成。','TRUNCATED',502);
  const content=choice?.message?.content;
  const toolCalls=choice?.message?.tool_calls;
  if(toolCalls!==undefined&&(!tools||!Array.isArray(toolCalls)||toolCalls.length>2||toolCalls.some(t=>typeof t.id!=='string'||t.id.length>200||t.type!=='function'||typeof t.function?.name!=='string'||typeof t.function?.arguments!=='string'||t.function.arguments.length>6000)))throw new AppError('模型返回了无效的工具调用。','INVALID_TOOL_CALL',502);
  if((typeof content!=='string'||!content.trim())&&!toolCalls?.length)throw new AppError('模型没有返回可显示的回答。','EMPTY_RESPONSE',502);
  // Defensive scrub in case a proxy repeats the credential in its response.
  const text=(content||'').split(config.key).join('[REDACTED]').slice(0,24000);
  const usage={};for(const k of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isFinite(data?.usage?.[k]))usage[k]=data.usage[k];
  return {text,model:config.model,usage,toolCalls:toolCalls||[]};
}
