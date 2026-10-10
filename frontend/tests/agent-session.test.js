import test from 'node:test';
import assert from 'node:assert/strict';

test('expired local session is renewed once for reads; mutations never auto-repeat',async()=>{
  const original=globalThis.fetch;let sessions=0,reads=0,posts=0;
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/session')){sessions++;return Response.json({csrf:`token-${sessions}`});}
    if(options.method==='POST'){posts++;return Response.json({message:'会话过期'},{status:401});}
    reads++;return reads===1?Response.json({message:'会话过期'},{status:401}):Response.json({jobs:[]});
  };
  try{
    const {agentRequest}=await import('../src/agent-api.js');
    assert.deepEqual(await agentRequest('/jobs'),{jobs:[]});assert.equal(sessions,2);assert.equal(reads,2);
    await assert.rejects(agentRequest('/jobs',{}),/会话过期/);assert.equal(posts,1);
  }finally{globalThis.fetch=original;}
});
