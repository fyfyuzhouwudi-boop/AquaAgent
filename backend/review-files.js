import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {AppError} from './providers.js';

const LIMIT=4*1024*1024;
const TYPES={'image/png':'.png','image/jpeg':'.jpg','application/pdf':'.pdf','text/plain':'.txt'};
const allFiles=job=>[...(job.reviewHistory||[]),job.review].filter(Boolean).flatMap(r=>r.attachments||[]);

export function prepareReviewFiles(input,job){
  const uploads=input.attachments??[];
  const retainedIds=input.retainedAttachmentIds??(job.review?.attachments||[]).map(a=>a.id);
  if(!Array.isArray(uploads)||!Array.isArray(retainedIds)||uploads.length+retainedIds.length>4||new Set(retainedIds).size!==retainedIds.length)throw new AppError('每次核对最多保留 4 个附件。');
  const retained=retainedIds.map(id=>{
    const file=job.review?.attachments?.find(a=>a.id===id);
    if(!file)throw new AppError('附件不属于当前核对记录。');
    return file;
  });
  const pending=uploads.map(file=>{
    if(!file||typeof file.name!=='string'||file.name.length>180||/[\x00-\x1f\x7f/\\]/.test(file.name)||!file.name.trim()||typeof file.data!=='string'||file.data.length>5_700_000)throw new AppError('附件名称或内容无效。');
    const match=/^data:(image\/png|image\/jpeg|application\/pdf|text\/plain);base64,([A-Za-z0-9+/]+={0,2})$/.exec(file.data);
    if(!match)throw new AppError('附件仅支持 JPG、PNG、PDF 和 TXT。');
    const type=match[1],bytes=Buffer.from(match[2],'base64');
    if(!bytes.length||bytes.length>LIMIT||bytes.toString('base64')!==match[2])throw new AppError('附件内容无效或超过 4 MB。');
    const ext=path.extname(file.name).toLowerCase();
    if(!(type==='image/jpeg'?['.jpg','.jpeg']:[TYPES[type]]).includes(ext))throw new AppError('附件扩展名与内容类型不匹配。');
    const signature=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':!bytes.includes(0);
    if(!signature)throw new AppError('附件内容与文件格式不符。');
    if(type==='text/plain'){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new AppError('TXT 附件请使用 UTF-8 编码。');}}
    return {meta:{id:randomUUID(),name:file.name.trim(),type,size:bytes.length},bytes};
  });
  if([...retained,...pending.map(p=>p.meta)].reduce((n,a)=>n+a.size,0)>LIMIT)throw new AppError('本次核对的附件合计不能超过 4 MB。');
  const unique=new Map(allFiles(job).map(a=>[a.id,a]));
  if([...unique.values()].reduce((n,a)=>n+a.size,0)+pending.reduce((n,p)=>n+p.meta.size,0)>20*1024*1024)throw new AppError('该任务历史附件已达到 20 MB 上限。');
  return {retained,pending};
}

export function persistReviewFiles(directory,pending){
  mkdirSync(directory,{recursive:true});const written=[];
  try{for(const file of pending){const target=path.join(directory,file.meta.id);writeFileSync(target,file.bytes,{flag:'wx'});written.push(target);}}
  catch(error){for(const target of written)unlinkSync(target);throw error;}
  return ()=>{for(const target of written)unlinkSync(target);};
}

export function readReviewFile(directory,job,id){
  const meta=allFiles(job).find(a=>a.id===id);
  if(!meta)throw new AppError('附件不存在。','NOT_FOUND',404);
  try{return {meta,bytes:readFileSync(path.join(directory,meta.id))};}
  catch(error){if(error.code==='ENOENT')throw new AppError('附件文件缺失，请从备份恢复。','NOT_FOUND',404);throw error;}
}
