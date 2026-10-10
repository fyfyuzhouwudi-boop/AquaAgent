// Isolated UI acceptance fixture: never reads production state or credentials.
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../store.js';
import {createApp} from '../server.js';
import {createServer} from '../../frontend/node_modules/vite/dist/node/index.js';
const base=fileURLToPath(new URL('../data/tests/',import.meta.url));mkdirSync(base,{recursive:true});
const dir=mkdtempSync(path.join(base,'case-ui-')),store=new Store(path.join(dir,'state.json')),env=path.join(dir,'.env');writeFileSync(env,'');
const now=new Date().toISOString();
for(let i=0;i<2;i++)store.data.jobs.push({id:randomUUID(),scope:'界面验收鱼缸',prompt:`界面验收任务 ${i+1}：复查体表变化（测试数据）`,type:'inspection',status:'succeeded',version:2,createdAt:now,reviewStatus:'reviewed',review:{decision:'needs_evidence',reason:'验收用核对记录，继续观察',at:now,attachments:[]},reviewHistory:[],result:'## 观察记录\n这是隔离验收数据，用于检查病例流程。',steps:[{id:'vision',name:'视觉观察',provider:'qwen',status:'succeeded',output:'测试观察记录'},{id:'coordinator',name:'综合研判',provider:'qwen',status:'succeeded',output:'这是隔离验收数据。'},{id:'evidence',name:'资料检索',provider:'coze',status:'skipped'},{id:'followup',name:'随访整理',provider:'deepseek',status:'succeeded',output:'补充观察记录。'}],sources:[],historyIds:[]});store.save();
const backend=createApp({store,configFile:env,configEnv:{},call:async()=>{throw Error('Cloud calls disabled in UI fixture');}});await new Promise(r=>backend.listen(0,'127.0.0.1',r));
const ui=await createServer({configFile:false,root:fileURLToPath(new URL('../../frontend/',import.meta.url)),server:{host:'127.0.0.1',port:4175,strictPort:true,proxy:{'/api/agents':{target:`http://127.0.0.1:${backend.address().port}`,headers:{host:'127.0.0.1:8000',origin:'http://127.0.0.1:8000'}}}}});await ui.listen();
console.log(JSON.stringify({url:'http://localhost:4175/#agents?job='+store.data.jobs[0].id,secondJob:store.data.jobs[1].id,directory:dir}));
const stop=async()=>{await ui.close();backend.close();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
