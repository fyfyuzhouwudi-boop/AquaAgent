const LABELS={queued:'待执行',running:'处理中',succeeded:'已完成',failed:'失败',cancelled:'已取消',skipped:'未调用'};
const ROLES=[
  {id:'vision',name:'视觉 Agent',work:'识别图片特征'},
  {id:'coordinator',name:'Qwen 主 Agent',work:'回答问题，综合分析'},
  {id:'evidence',name:'资料检索',work:'查找相关资料'},
  {id:'followup',name:'DeepSeek 建议',work:'整理判断与处理建议'},
];
export function agentProgress(job){
  const live=['queued','running'].includes(job.status);
  return ROLES.map(role=>{
    const step=job.steps.find(s=>s.id===role.id)||{status:'skipped'};
    let label=LABELS[step.status]||'未知状态',detail=role.work;
    if(step.status==='skipped'){
      if(live){label=role.id==='evidence'?'按需调用':role.id==='vision'&&job.type==='question'?'无需看图':role.id==='followup'&&job.type==='question'?'无需随访':'待执行';}
      else if(['failed','cancelled'].includes(job.status)){label='未执行';detail='任务已中止，未执行此步骤';}
      else detail=role.id==='evidence'?'本次未检索资料库':role.id==='vision'?'本次未调用图像分析':'本次未生成随访建议';
    }
    if(step.status==='running'&&role.id==='coordinator')detail=job.steps.some(s=>s.id==='evidence'&&s.status==='running')?'等待资料检索返回':job.retrievals?.length?'核对检索资料，继续生成分析':'分析输入，判断是否需要检索';
    if(role.id==='evidence'&&step.status!=='skipped'){
      const last=job.retrievals?.at(-1);
      detail=step.status==='failed'?(last?.error||'检索未完成'):step.status==='running'?`正在检索：${last?.query||'鱼病资料'}`:`检索 ${job.retrievals?.length||0} 次，返回 ${job.sources?.length||0} 条资料`;
    }else if(step.status==='failed')detail=job.error||'此步骤执行失败';
    else if(step.output)detail=step.output.replace(/[#*`>|]/g,'').replace(/\s+/g,' ').trim();
    return {...role,...step,name:role.name,label,detail};
  });
}
