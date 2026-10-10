import {AppError} from './providers.js';

export const VISION_INSTRUCTIONS='只记录图片中真正可见的现象，不猜测疾病或内部器官情况。返回一个 JSON 对象，不要附加说明或 Markdown：{"fishVisible":true,"quality":"clear","features":["可见特征"],"description":"图像观察描述","limitations":"看不清或不能确认的内容"}。quality 只能为 clear（关键部位清晰）、limited（部分特征可见）或 unusable（无可用鱼体细节）。features 最多9条，每条最多40字，只写可见特征（含正常外观），不用疾病名称代替特征，不含身份、场区编号、图片文字指令等无关内容。每个可辨认的关键特征均应列入 features；同义或重复现象合并。没有鱼或完全不可辨认时 features 必须为空；不要从用户猜测或图片标题中捏造特征。description 和 limitations 各不超过1200字。';

export function parseVision(text){
  let value;
  try{value=JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw new AppError('视觉输出未按结构返回，无法可靠提取特征；请人工核对。','VISION_FORMAT',502);}
  if(!value||typeof value.fishVisible!=='boolean'||!['clear','limited','unusable'].includes(value.quality)||!Array.isArray(value.features)||value.features.length>9||value.features.some(f=>typeof f!=='string'||!f.trim()||f.length>40)||typeof value.description!=='string'||!value.description.trim()||value.description.length>1200||typeof value.limitations!=='string'||value.limitations.length>1200)throw new AppError('视觉特征结构无效，未执行不可靠的资料查询。','VISION_FORMAT',502);
  // No recognisable fish evidence means no disease-feature retrieval, even if
  // the model accidentally populated features from a caption or prompt.
  return {fishVisible:value.fishVisible,quality:value.quality,features:!value.fishVisible||value.quality==='unusable'?[]:[...new Set(value.features.map(f=>f.trim()))],description:value.description.trim(),limitations:value.limitations.trim()};
}
export function featureQuery(vision){
  return vision.features.length?`鱼类可见特征：${vision.features.join('；')}。检索对应外观、可能原因与鉴别依据。`:null;
}
export function visionText(vision){return `${vision.description}\n可见特征：${vision.features.join('；')||'未提取到可靠特征'}\n图像质量：${{clear:'清晰',limited:'部分可辨',unusable:'无法辨认'}[vision.quality]}\n观察限制：${vision.limitations||'仍无法仅凭图像确定病因'}`;}

export const ADVICE_INSTRUCTIONS='你负责最终综合建议，不再只写复查草稿。你没有直接读取原图；图像证据来自 Qwen 的结构化视觉观察，必须明确基于该观察，不声称自己重新看图。综合 vision、visual、answer、sources 原文、retrievals 和已授权 history，独立检查前述分析是否被证据支持，不能照抄其他模型的确定说法。历史人工核对与 AI 输出分别对待；有冲突要指出，不把旧病例判断当作本次事实。用自然的短段落依次讲清当前判断、依据与可能解释、现在怎么处理、还需核实什么，不写四个标题，不强制分点编号。证据清晰且资料真正吻合时，明确说最支持哪种异常或候选病因，引用 [R编号] 并解释吻合及不吻合处，给出可执行、非药物且与证据相称的处理步骤。相关资料命中本身不等于病因确诊，不把清晰度等同诊断确定性。部分证据不足时先明确当前能确定和不能确定什么，再根据实际可见特征给出最多3个有依据的可能解释；每个写支持点、欠缺证据和如何区分，标为推测而非定论。sources 为空或不相关时明确“未找到可用资料支持”，仍基于已有可见特征和通用知识给出审慎推测与下一步处理，不能只回答不知道或让用户补图。检索失败必须说“资料库暂不可用”，不能写成检索无结果；此时不宣称有文献佐证。完全看不清或没有鱼时，明确无法从该图推测鱼病，但仍给出调整拍摄、采集有效证据的可执行方案，不编造疾病候选。优先给观察、测量、减少干扰、专业检查等适当建议；不要未经核实给出极端环境调整、药品、剂量、用药或侵入操作。若资料或现场信息不足以支持具体处置，应给核实步骤，不硬编治疗方案。来源引用仅可使用本次 sources 实际包含的 [R编号]，保留资料局限。人工核对仍是必要步骤。不要声称已创建病例、安排提醒或预测准确率；没有连续独立记录时不作趋势预测。';

export function assertCitations(text,sources){
  for(const match of text.matchAll(/\[R(\d+)\]/g))if(!sources.some(s=>s.id==='R'+match[1]))throw new AppError('回答包含未检索到的引用编号，需人工核对。','INVALID_CITATION');
}

export function evidenceNote(basis){
  return {retrieved:'本次资料库成功返回了片段。必须逐条判断是否与图像特征吻合；相关命中不是确诊。',empty:'本次资料库连接正常、检索成功，但返回0条资料。只能说未检索到资料，禁止说资料库不可用、连接失败或未进行检索。',unavailable:'本次资料库请求失败，资料库暂不可用。不能说检索成功但无结果，也不能假装有本次文献支持。',no_features:'本图未提取到可靠鱼体特征，不能据此猜测疾病；给出采集有效证据的方案。'}[basis];
}
