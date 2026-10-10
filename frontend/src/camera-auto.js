const PROMPT='定时抽帧巡检。请只描述图中鱼体可见现象与图像清晰度；无法判断时说明需补拍或人工核对，不要仅凭图片确诊。';

export class CameraAutoAnalyzer{
  constructor({request,now=()=>Date.now(),onSubmitted=()=>{},onStop=()=>{}}){
    this.request=request;this.now=now;this.onSubmitted=onSubmitted;this.onStop=onStop;this.generation=0;this.busy=false;this.reset();
  }
  reset(){this.stop();this.lastSubmitted=null;this.count=0;this.activeJob=null;}
  stop(){this.enabled=false;this.generation++;}
  resume(){this.enabled=true;}
  halt(message){this.stop();this.onStop(message);}
  async submit(frame){
    if(!this.enabled)return 'disabled';
    if(this.busy)return 'busy';
    if(this.count>=10){this.halt('本次已自动提交 10 张，自动分析已停止。');return 'limit';}
    if(this.lastSubmitted!==null&&this.now()-this.lastSubmitted<60000)return 'cooldown';
    const generation=this.generation;
    this.busy=true;
    try{
      if(this.activeJob){const previous=await this.request('/jobs/'+this.activeJob);if(!this.enabled||generation!==this.generation)return 'stopped';if(['queued','running'].includes(previous.status))return 'running';if(previous.status!=='succeeded'){this.halt('上一张分析未完成，自动分析已停止。请在图像审计中检查任务。');return 'failed';}this.activeJob=null;}
      const capture={kind:'camera',mode:'scheduled',frameId:frame.id,cameraName:frame.camera,width:frame.width,height:frame.height,capturedAt:frame.capturedAt};
      const response=await this.request('/jobs',{type:'inspection',scope:frame.scope,prompt:PROMPT,image:frame.image,capture,cloudConsent:true,includeHistory:false},frame.id);
      if(generation!==this.generation)return 'stopped';
      this.activeJob=response.id;this.lastSubmitted=this.now();this.count++;
      this.onSubmitted(this.count,response.id);
      if(this.count>=10)this.halt('本次已自动提交 10 张，自动分析已停止。');
      return 'submitted';
    }catch(error){if(generation===this.generation)this.halt(`自动分析已停止：${error.message}。请检查任务记录后再开启。`);return 'failed';}
    finally{this.busy=false;}
  }
}
