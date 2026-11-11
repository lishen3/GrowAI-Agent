import type { AgentContext, ReviewTaskFact } from '@/domain/agent/types';
import { occurredInWindow } from '@/domain/agent/planVsReality';
import { normalizeMemoryContent } from '@/domain/memory/types';
import { reviewSnapshotSchema, type EvidenceReference, type WeeklyReflectionDraft } from './types';

/** Checks identifiers, typed field values and explicit goal chains, not arbitrary prose entailment. */
export function validateGrowthReflection(context: AgentContext, draft: WeeklyReflectionDraft) {
  const fail = (): never => { throw new Error('复盘证据无效，未保存：引用、范围或目标关联无法核验'); };
  if (!draft.growth) return fail();
  const start = context.currentWeek.windowStart; const end = context.currentWeek.windowEnd;
  if (context.reviewFacts.windowStart !== start || context.reviewFacts.windowEnd !== end) fail();
  if (context.categories?.some(row => row.journeyId !== context.journey.id)) fail();
  if (context.reflectionWindow) {
    const upper = new Date(end + 'T00:00:00'); upper.setDate(upper.getDate() + 1);
    if (Date.parse(context.reflectionWindow.startAt) !== new Date(start + 'T00:00:00').getTime()
      || Date.parse(context.reflectionWindow.endExclusiveAt) !== upper.getTime()) fail();
  }
  const records = new Map<string, Record<string, unknown>>();
  const labels = new Map<string, string>();
  function add(source: string, row: object & { id: string }, label: string) {
    const key = source + ':' + row.id;
    if (records.has(key) && Object.entries(row).some(([field, value]) =>
      field in records.get(key)! && JSON.stringify(records.get(key)![field]) !== JSON.stringify(value))) fail();
    records.set(key, { ...records.get(key), ...row }); labels.set(key, label);
  }
  context.longTermGoals.forEach(row => add('LONG_TERM_GOAL', row, row.title));
  context.periodGoals.forEach(row => add('PERIOD_GOAL', row, row.title));
  context.weeklyGoals.forEach(row => add('WEEKLY_GOAL', row, row.title));
  const tasks = context.reflectionTasks ?? [...context.tasks, ...context.planVsReality.completedTasks, ...context.planVsReality.unfinishedTasks];
  tasks.forEach(row => {
    if (row.categoryId && !context.categories?.some(category => category.id === row.categoryId)) fail();
    if ('periodId' in row && row.periodId !== context.currentPeriod.id) fail();
    const scheduled = context.schedule?.events.some(event => 'taskId' in event && event.taskId === row.id
      && event.date >= start && event.date <= end);
    const occurred = context.recentExecutions.some(event => event.taskId === row.id && occurredInWindow(event.completedAt, start, end))
      || context.recentAchievements.some(event => event.sourceId === row.id && occurredInWindow(event.occurredAt, start, end));
    if (!(scheduled || occurred || (row.plannedDate !== null && row.plannedDate >= start && row.plannedDate <= end))) fail();
    add('TASK', row, row.title);
  });
  // Repeated views of a record must not contradict the reflection-only projection.
  for (const row of [...context.tasks, ...context.planVsReality.completedTasks, ...context.planVsReality.unfinishedTasks]) {
    if (records.has('TASK:' + row.id)) add('TASK', row, row.title);
  }
  context.recentExecutions.forEach(row => {
    if (!occurredInWindow(row.completedAt, start, end)) fail();
    add('EXECUTION', row, records.get('TASK:' + row.taskId)?.title as string || row.taskId);
  });
  context.recentAchievements.forEach(row => {
    if (!occurredInWindow(row.occurredAt, start, end)) fail();
    add('ACHIEVEMENT', row, row.title);
  });
  add('STAT', { id: 'reviewFacts', ...context.reviewFacts }, '程序计算的本周统计');
  context.reviewFacts.categoryBreakdown.forEach(row => {
    const id = row.categoryId ?? row.category;
    add('STAT', { id: 'category:' + id, ...row }, context.categories?.find(item => item.id === id)?.name ?? id);
  });
  if (context.reflectionTotals) add('STAT', { id: 'reflectionTotals', ...context.reflectionTotals }, '本周全部执行记录统计');
  const evidence: { reference: EvidenceReference; label: string }[] = [];
  function verify(refs: EvidenceReference[] | undefined) {
    if (!refs?.length) return fail();
    for (const ref of refs) {
      const key = ref.source + ':' + ref.id; const row = records.get(key);
      if (!row || !Object.hasOwn(row, ref.field) || JSON.stringify(row[ref.field]) !== JSON.stringify(ref.value)) fail();
      evidence.push({ reference: ref, label: labels.get(key)! });
    }
  }
  for (const fact of [...draft.facts, ...draft.insights]) verify(fact.references);
  const memoryContents = new Set(context.memories.map(row => normalizeMemoryContent(row.content)));
  for (const candidate of draft.memoryCandidates) {
    verify(candidate.references);
    if (memoryContents.has(normalizeMemoryContent(candidate.content))) fail();
    memoryContents.add(normalizeMemoryContent(candidate.content));
  }
  const seen = new Set<string>();
  for (const analysis of draft.growth.goalAnalyses) {
    if (!records.has('LONG_TERM_GOAL:' + analysis.goalId) || seen.has(analysis.goalId)) fail();
    seen.add(analysis.goalId); verify(analysis.references);
    if (!analysis.references.some(ref => ref.source === 'LONG_TERM_GOAL' && ref.id === analysis.goalId)) fail();
    if (analysis.progress === 'INSUFFICIENT') {
      if (analysis.confidence !== 'LOW') fail();
    } else if (!analysis.actions.length) fail();
    if (['EVIDENCED', 'PARTIAL'].includes(analysis.progress) && !analysis.actions.some(row => row.claim === 'COMPLETED')) fail();
    for (const action of analysis.actions) {
      const task = records.get('TASK:' + action.taskId) as ReviewTaskFact | undefined;
      if (!task) return fail();
      verify(action.references);
      // Every action must cite its own task (and not someone else's execution).
      if (!action.references.some(ref => ref.source === 'TASK' && ref.id === task.id)) fail();
      for (const ref of action.references) {
        if (ref.source === 'EXECUTION' && records.get('EXECUTION:' + ref.id)?.taskId !== task.id) fail();
        if (ref.source === 'ACHIEVEMENT' && records.get('ACHIEVEMENT:' + ref.id)?.sourceId !== task.id) fail();
      }
      if (action.claim === 'COMPLETED' && (task.status !== 'DONE' || !action.references.some(ref =>
        ref.source === 'TASK' && ref.id === task.id && ref.field === 'status' && ref.value === 'DONE'))) fail();
      // A cancelled plan is not a failed/completed action or progress evidence.
      if (task.status === 'CANCELLED' && analysis.progress !== 'INSUFFICIENT') fail();
      if (analysis.progress === 'EVIDENCED' && action.claim !== 'COMPLETED') fail();
      if (analysis.progress === 'EVIDENCED' && !action.references.some(ref => ['EXECUTION', 'ACHIEVEMENT'].includes(ref.source))) fail();
      if (action.relationship === 'INFERRED' && analysis.confidence === 'HIGH') fail();
      if (action.relationship === 'DIRECT') {
        const weekly = context.weeklyGoals.find(row => row.id === task.weeklyGoalId);
        if (task.weeklyGoalId && !weekly) fail();
        if (task.periodGoalId && weekly && task.periodGoalId !== weekly.periodGoalId) fail();
        const period = context.periodGoals.find(row => row.id === (task.periodGoalId ?? weekly?.periodGoalId));
        if (!period || period.longTermGoalId !== analysis.goalId) fail();
      }
    }
  }
  draft.growth.nextWeekSuggestions.forEach(row => verify(row.references));
  return reviewSnapshotSchema.parse({ windowStart: start, windowEnd: end, facts: context.reviewFacts,
    goals: context.longTermGoals.map(({ id, title, status, targetDescription }) => ({ id, title, status, targetDescription })),
    categories: context.categories?.map(({ id, name }) => ({ id, name })) ?? [],
    ...(context.reflectionTotals ? { executionTotals: context.reflectionTotals } : {}),
    evidence: [...new Map(evidence.map(row => [JSON.stringify(row.reference), row])).values()],
    scopeNote: '仅分析本周授权记录；统计由程序计算。计划统计含本周时间块任务及无时间块的本周计划任务；其实际用时只统计这些计划任务。全部执行统计独立按发生时间归属本周。任务状态不是完成日期，未知保留 null；近期明细有上限，历史摘要不是当前周事实；证据校验不等于自然语言推断已被证明。',
  });
}
