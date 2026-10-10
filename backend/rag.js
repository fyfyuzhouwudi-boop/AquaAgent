import {AppError} from './providers.js';

// Only the explicitly configured HTTPS origin may receive the RAG credential.
// Redirects remain forbidden; an endpoint URL alone never enables retrieval.
export function ragEndpoint(config){
  if(!config?.key||!config.url||!config.allowedOrigin)throw new AppError('知识库尚未配置完整，请同时设置地址、允许的 HTTPS 来源及密钥。','RAG_NOT_CONFIGURED',503);
  let url,allowed;
  try{url=new URL(config.url);allowed=new URL(config.allowedOrigin);}catch{throw new AppError('知识库地址或允许来源格式不正确。','RAG_CONFIG',503);}
  if(url.protocol!=='https:'||url.username||url.password||config.url.includes('?')||config.url.includes('#')||allowed.protocol!=='https:'||config.allowedOrigin!==allowed.origin||url.origin!==allowed.origin)throw new AppError('知识库地址须使用 HTTPS、匹配服务端明确允许的来源，且不能包含账号、查询参数或片段。','RAG_CONFIG',503);
  return url.href;
}
export function ragStatus(config){
  let configured=false;try{ragEndpoint(config);configured=true;}catch{}
  return {configured,url:configured?config.url:'',name:'Coze 鱼病文献知识库'};
}
export const SEARCH_TOOL={type:'function',function:{name:'search_fish_knowledge',description:'需要专业依据、区分相似病害、解释病因或对知识不确定时，检索用户鱼病文献。只发送必要症状与鱼种，不发送身份、密钥、图片或完整历史。返回原文不是诊断；相关度不是疾病概率。',parameters:{type:'object',properties:{query:{type:'string',description:'症状、鱼种和需要查证的问题，最多 500 字'},reason:{type:'string',description:'为什么需要检索，最多 300 字'}},required:['query','reason'],additionalProperties:false}}};
export function validateSearch(args){
  if(!args||typeof args.query!=='string'||!args.query.trim()||args.query.length>500||typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>300||Object.keys(args).some(k=>!['query','reason'].includes(k)))throw new AppError('检索工具参数不符合约定。','INVALID_TOOL_ARGS');
  return {query:args.query.trim(),reason:args.reason.trim()};
}
export async function searchRag(config,query,{signal,fetcher=fetch}={}){
  const url=ragEndpoint(config);
  if(typeof query!=='string'||!query.trim()||query.length>500)throw new AppError('检索问题长度不符合要求。');
  let response;
  try{
    response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(45000),...(signal?[signal]:[])]),headers:{'Content-Type':'application/json','X-API-Key':config.key},body:JSON.stringify({query,top_k:3})});
  }catch{throw new AppError(signal?.aborted?'检索已取消。':'知识库连接失败或超过 45 秒。','RAG_CONNECTION',502);}
  if(!response.ok)throw new AppError(`知识库请求失败（HTTP ${response.status}），未将错误当作无结果。`,'RAG_UPSTREAM',502);
  let data;try{data=await response.json();}catch{throw new AppError('知识库没有返回有效 JSON。','RAG_FORMAT',502);}
  if(!data||data.error||!Array.isArray(data.sources)||data.sources.length>50)throw new AppError('知识库返回结构不符合约定。','RAG_FORMAT',502);
  const scrub=v=>String(v).split(config.key).join('[REDACTED]');
  return data.sources.slice(0,3).map((s,i)=>{
    if(!s||typeof s.name!=='string'||typeof s.snippet!=='string'||!s.snippet.trim()||typeof s.documentId!=='string')throw new AppError('知识库片段缺少文档或原文信息。','RAG_FORMAT',502);
    const page=Number.isInteger(s.page)&&s.page>0?s.page:null;
    return {id:`R${i+1}`,title:scrub(s.name).slice(0,300),source:scrub(s.name).slice(0,300)+(page?` · 第 ${page} 页（服务提取，待核对）`:''),documentId:scrub(s.documentId).slice(0,200),page,chunkIndex:Number.isInteger(s.chunkIndex)?s.chunkIndex:null,score:Number.isFinite(s.score)?s.score:null,text:scrub(s.snippet).slice(0,3500)};
  });
}
