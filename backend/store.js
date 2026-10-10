import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';

export class Store {
  constructor(file){
    this.file=file;mkdirSync(dirname(file),{recursive:true});
    this.data=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:1,jobs:[],audit:[]};
    if(this.data.version!==1||!Array.isArray(this.data.jobs)||!Array.isArray(this.data.audit))throw new Error('Invalid local data. Original file retained; refusing to start.');
    if(this.data.cases!==undefined&&!Array.isArray(this.data.cases))throw new Error('Invalid case data. Original file retained.');
    this.data.cases??=[];
    for(const job of this.data.jobs)if(['queued','running'].includes(job.status)){
      job.status='failed';job.error='本地服务重启，任务中断；没有自动重发付费请求。';
      for(const step of job.steps)if(step.status==='running')step.status='failed';
    }
    this.save();
  }
  save(){const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.data,null,2));renameSync(temp,this.file);}
  audit(action,target,detail){this.data.audit.unshift({at:new Date().toISOString(),actor:'local-operator',action,target,detail});this.save();}
}
