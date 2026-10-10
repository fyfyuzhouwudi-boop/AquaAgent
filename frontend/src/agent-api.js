let csrf=null;
let sessionPromise=null;
async function request(url,options){
  try{return await fetch(url,options);}
  catch(error){
    if(error.name==='TimeoutError')throw new Error('请求超时，请刷新任务记录后再试。');
    if(error instanceof TypeError)throw new Error('本地服务未连接，请双击「启动平台」后刷新。');
    throw error;
  }
}
async function ensureSession(){
  if(csrf)return;
  if(!sessionPromise){
    sessionPromise=(async()=>{
      const session=await decode(await request('/api/agents/session',{credentials:'same-origin',signal:AbortSignal.timeout(10000)}));
      csrf=session.csrf;
    })().finally(()=>{sessionPromise=null;});
  }
  await sessionPromise;
}
async function decode(response){
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data){if(response.status===401)csrf=null;throw new Error(data?.message||'本地 Agent 服务不可用，请双击启动平台后重试。');}
  return data;
}
export async function agentRequest(path,body,operationId){
  await ensureSession();
  const sessionToken=csrf;
  const send=()=>request('/api/agents'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',signal:AbortSignal.timeout(path==='/test'?100000:15000),headers:{...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf}),...(operationId?{'Idempotency-Key':operationId}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let response=await send();
  // Only retry read-only requests after renewing an expired local session.
  if(response.status===401&&body===undefined){
    if(csrf===sessionToken)csrf=null;
    await ensureSession();response=await send();
  }
  return decode(response);
}
