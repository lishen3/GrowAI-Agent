// Synthetic presentation data only. Never a Task, Approval or execution record.
export const replanDemoFixture = Object.freeze({
  userFeedback: '最近英语任务压力比较大，帮我调整一下计划。',
  taskTitle: '英语听力训练',
  beforeDate: '2026-10-08',
  afterDate: '2026-10-10',
  minutes: 60,
  priority: 'A',
  goal: '持续提升英语听力能力',
  judgment: '可以尝试换一天完成听力训练，保持原计划投入。',
  reason: '按照示例日期调整计划，不减少时长，也不改变任务内容。',
});

export type ReplanDemoState = 'READY' | 'SHOW_PROPOSAL' | 'AWAITING_APPROVAL' | 'APPROVED' | 'DEMO_SUCCESS' | 'REJECTED';
export type ReplanDemoEvent = 'SHOW' | 'REVIEW' | 'APPROVE' | 'REJECT' | 'FINISH' | 'RESET';

export function nextReplanDemoState(state: ReplanDemoState, event: ReplanDemoEvent): ReplanDemoState {
  if (event === 'RESET') return 'READY';
  if (state === 'READY' && event === 'SHOW') return 'SHOW_PROPOSAL';
  if (state === 'SHOW_PROPOSAL' && event === 'REVIEW') return 'AWAITING_APPROVAL';
  if (state === 'AWAITING_APPROVAL' && event === 'APPROVE') return 'APPROVED';
  if (state === 'AWAITING_APPROVAL' && event === 'REJECT') return 'REJECTED';
  if (state === 'APPROVED' && event === 'FINISH') return 'DEMO_SUCCESS';
  return state;
}
