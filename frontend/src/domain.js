export const ASSET = '/assets/pond-demo.svg';
export const EVENT_STATUS = {
  pending_analysis: ['待分析', 'blue'], pending_review: ['待人工复核', 'orange'],
  needs_evidence: ['等待补充', 'orange'], observing: ['观察中', 'blue'], closed: ['已关闭', 'green'],
};
export const TASK_STATUS = {
  queued: ['排队中', 'gray'], running: ['分析中', 'blue'], succeeded: ['已完成', 'green'],
  failed: ['执行失败', 'red'], cancelled: ['已取消', 'gray'],
};
export class DomainError extends Error {
  constructor(message, code) { super(message); this.name = 'DomainError'; this.code = code; }
}
export function createSeed(now = Date.now()) {
  const ago = sec => new Date(now - sec * 1000).toISOString();
  const points = [1, 2, 3, 4].map(n => ({
    id: `pond-${n}`, name: `${n}号池`, camera: `摄像头0${n}`, siteId: 'demo', species: '草鱼',
    deviceStatus: n === 4 ? 'offline' : 'online', streamUrl: null,
    snapshot: { id: `snap-${n}`, url: ASSET, capturedAt: ago(20 + n * 10), analyzedAt: ago(14 + n * 10) },
  }));
  return {
    schemaVersion: 1, points,
    plans: points.map(p => ({ id: `plan-${p.id}`, pointId: p.id, interval: 60, enabled: p.id !== 'pond-4', nextRunAt: new Date(now + 60000).toISOString(), version: 1 })),
    events: [
      { id: 'EV-0926', pointId: 'pond-3', title: '体表异常待核实', status: 'pending_review', severity: 'attention', createdAt: ago(40), updatedAt: ago(34), version: 1, snapshot: {...points[2].snapshot}, finding: '演示场景：视觉巡检提示需进一步查看体表局部。当前示例图片不构成病害证据。', gaps: ['缺少异常部位近照', '需补充发现时间及进食变化'], reviews: [], caseId: null },
      { id: 'EV-0925', pointId: 'pond-2', title: '需要补充局部照片', status: 'needs_evidence', severity: 'attention', createdAt: ago(310), updatedAt: ago(304), version: 1, snapshot: {...points[1].snapshot}, finding: '演示场景：现有画面不足以支持进一步研判。', gaps: ['请上传清晰的局部照片'], reviews: [], caseId: null },
      { id: 'EV-0924', pointId: 'pond-1', title: '持续观察进食情况', status: 'observing', severity: 'low', createdAt: ago(720), updatedAt: ago(700), version: 1, snapshot: {...points[0].snapshot}, finding: '演示场景：已由运营者安排后续观察。', gaps: ['等待下次复查记录'], reviews: [], caseId: 'CASE-001' },
      { id: 'EV-0923', pointId: 'pond-1', title: '复核为误报', status: 'closed', severity: 'low', createdAt: ago(1800), updatedAt: ago(1700), version: 2, snapshot: {...points[0].snapshot}, finding: '演示场景：人工复核后关闭。', gaps: [], reviews: [{ id: 'RV-seed', decision: 'false_positive', reason: '演示记录：已复核原始截图，标记为误报。', at: ago(1700), operator: '演示运营者' }], caseId: null },
    ],
    runs: [
      { id: 'RUN-001', pointId: 'pond-3', status: 'succeeded', outcome: 'uncertain', createdAt: ago(40), completedAt: ago(34), steps: ['succeeded','succeeded','succeeded','succeeded'], eventId: 'EV-0926', attempt: 1 },
      { id: 'RUN-002', pointId: 'pond-2', status: 'failed', outcome: 'failure', createdAt: ago(180), completedAt: ago(150), steps: ['succeeded','failed','queued','queued'], error: '演示故障：云端分析响应超时。', attempt: 1 },
    ],
    cases: [{ id: 'CASE-001', pointId: 'pond-1', eventIds: ['EV-0924'], title: '1号池异常观察记录', status: 'observing', createdAt: ago(720), followups: [] }],
    audit: [], operations: {},
  };
}

export function reviewEvent(state, { eventId, version, decision, reason, operationId }, now = new Date().toISOString()) {
  if (state.operations[operationId]) {
    const previous = state.operations[operationId];
    if (previous.fingerprint !== JSON.stringify({eventId,version,decision,reason})) throw new DomainError('重复操作编号与原请求不一致。', 'IDEMPOTENCY_CONFLICT');
    return state;
  }
  const event = state.events.find(e => e.id === eventId);
  if (!event) throw new DomainError('事件不存在。', 'NOT_FOUND');
  if (event.version !== version) throw new DomainError('事件已被更新，请重新打开详情后提交。', 'VERSION_CONFLICT');
  if (event.status === 'closed') throw new DomainError('该事件已经关闭。', 'CLOSED');
  if (!reason?.trim() || reason.trim().length > 1000) throw new DomainError('请填写 1 至 1000 字的审核依据。', 'VALIDATION');
  const target = { confirmed: 'observing', false_positive: 'closed', needs_evidence: 'needs_evidence', observe: 'observing', close: 'closed' }[decision];
  if (!target) throw new DomainError('无效的审核结论。', 'VALIDATION');
  const result = structuredClone(state);
  const next = result.events.find(e => e.id === eventId);
  next.status = target; next.version++; next.updatedAt = now;
  next.reviews.push({ id: `RV-${operationId}`, decision, reason: reason.trim(), at: now, operator: '演示运营者' });
  result.audit.unshift({ id: operationId, at: now, action: '人工复核', target: eventId, detail: reason.trim() });
  result.operations[operationId] = { fingerprint: JSON.stringify({eventId,version,decision,reason}) };
  return result;
}

export function finishInspection(state, runId, now = new Date().toISOString()) {
  const next = structuredClone(state);
  const run = next.runs.find(r => r.id === runId);
  if (!run || run.status !== 'running') return state;
  if (run.outcome === 'failure') {
    run.status = 'failed'; run.steps = ['succeeded','failed','queued','queued'];
    run.error = '演示故障：云端响应超时。请检查服务或受控重试。'; run.completedAt = now;
    return next;
  }
  run.status = 'succeeded'; run.steps = [ 'succeeded','succeeded','succeeded','succeeded' ]; run.completedAt = now;
  const point = next.points.find(p => p.id === run.pointId);
  point.snapshot = { id: `snap-${run.id}`, url: run.snapshotUrl || ASSET, capturedAt: run.createdAt, analyzedAt: now };
  if (run.outcome === 'normal') return next;
  const existing = next.events.find(e => e.pointId === point.id && e.status !== 'closed' && Date.parse(now) - Date.parse(e.updatedAt) < 5 * 60 * 1000);
  if (existing) {
    // 原始审核证据保持不变；新截图只追加为证据引用。
    existing.additionalEvidence = [...(existing.additionalEvidence || []), {...point.snapshot}];
    existing.updatedAt = now; existing.version++; run.eventId = existing.id;
  } else {
    const id = `EV-${run.id.slice(4)}`;
    next.events.unshift({ id, pointId: point.id, title: '巡检发现需复核的可见异常', status: 'pending_review', severity: 'attention', createdAt: now, updatedAt: now, version: 1, snapshot: {...point.snapshot}, finding: '这是流程演示结果，没有调用模型。请在接入真实视觉服务后进行专业复核。', gaps: ['需要人工核对原始画面', '需要补充局部证据'], reviews: [], caseId: null });
    run.eventId = id;
  }
  return next;
}
