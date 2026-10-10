import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readConfig,endpoint,publicConfig} from '../providers.js';
import {ragEndpoint} from '../rag.js';

function fixture(t){
 const directory=mkdtempSync(path.join(tmpdir(),'aquaagent-config-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 return path.join(directory,'.env');
}
test('server environment overrides file values; explicit empty values disable them',t=>{
 const file=fixture(t);
 writeFileSync(file,'QWEN_BASE_URL=https://file.example.test/v1\nQWEN_MODEL=file-model\nQWEN_API_KEY=synthetic-file-key\nDEEPSEEK_MODEL=file-advisor\nRAG_SEARCH_URL=https://file.example.test/search\nRAG_ALLOWED_ORIGIN=https://file.example.test\nRAG_API_KEY=synthetic-file-rag\n');
 const config=readConfig(file,{env:{QWEN_BASE_URL:' https://env.example.test/v1 ',QWEN_MODEL:' env-model ',QWEN_API_KEY:' synthetic-env-key ',DEEPSEEK_MODEL:'',RAG_SEARCH_URL:'https://rag.example.test/search',RAG_ALLOWED_ORIGIN:'https://rag.example.test',RAG_API_KEY:'synthetic-env-rag'}});
 assert.equal(endpoint(config.qwen),'https://env.example.test/v1/chat/completions');
 assert.equal(config.qwen.model,'env-model');assert.equal(config.qwen.key,'synthetic-env-key');
 assert.equal(config.deepseek.model,'');
 assert.equal(ragEndpoint(config.rag),'https://rag.example.test/search');
 assert.ok(!JSON.stringify(publicConfig(config)).includes(config.qwen.key));
});
test('an injected empty environment isolates file configuration from the host',t=>{
 const file=fixture(t);writeFileSync(file,'QWEN_MODEL=file-model\n');
 const config=readConfig(file,{env:{}});
 assert.equal(config.qwen.model,'file-model');assert.equal(config.qwen.key,'');
 assert.throws(()=>endpoint(config.qwen),e=>e.code==='NOT_CONFIGURED');
});
test('missing optional file and absent configuration fail safely without a request',t=>{
 const file=fixture(t),config=readConfig(file,{env:{}});
 for(const provider of [config.qwen,config.deepseek])assert.throws(()=>endpoint(provider),e=>e.code==='NOT_CONFIGURED'&&e.status===503);
 assert.throws(()=>ragEndpoint(config.rag),e=>e.code==='RAG_NOT_CONFIGURED');
 assert.ok(publicConfig(config).every(provider=>!provider.configured&&!provider.keyPresent));
});
