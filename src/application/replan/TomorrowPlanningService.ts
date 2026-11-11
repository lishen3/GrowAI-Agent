import { declaredAvailabilitySchema } from '@/domain/replan/timeOperation';
import { timeRuntimeDate } from '@/domain/replan/timeRuntime';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { AgentContextService } from '@/application/agent/AgentContextService';

import { calendarMinutes } from '@/domain/scheduling/calendarInteraction';
import type { TimeReplanService } from './TimeReplanService';

/** Rank real tasks, then reuse the existing per-item proposal/confirmation protocol. No batch writes. */
export class TomorrowPlanningService {
  constructor(private readonly store: GrowthStore, private readonly time: TimeReplanService, private readonly now: () => Date = () => new Date()) {}
  async read() {
    const journey = await this.store.getJourney(); if (!journey?.currentPeriodId) throw new Error('请先选择阶段');
    const period = (await this.store.listPeriods(journey.id)).find(p => p.id === journey.currentPeriodId);
    const today = timeRuntimeDate(this.now());
    const tomorrow = timeRuntimeDate(new Date(Date.parse(`${today}T00:00:00+08:00`)+86400000));
    if (!period || period.status !== 'ACTIVE' || tomorrow < period.startDate || tomorrow > period.endDate) throw new Error('明天不属于当前进行中的阶段');
    const context = await new AgentContextService(this.store, this.now).buildTime({ journeyId: journey.id, periodId: period.id, date: today }, { startDate: today, endDate: tomorrow });
    const tasks = await this.store.listTasks({ periodId: period.id });
    const priorities = ['S','A','B','C'];
    const recommendations = tasks.filter(t => t.periodId === period.id && ['TODO','DELAYED'].includes(t.status)).map(task => {
      const parent = context.periodGoals.find(p => p.id === task.periodGoalId)
        ?? context.periodGoals.find(p => context.weeklyGoals.some(w => w.id === task.weeklyGoalId && w.periodGoalId === p.id));
      const goal = context.longTermGoals.find(g => g.id === parent?.longTermGoalId);
      const deadline = task.deadline ?? goal?.planning?.endDate ?? null;
      const existingEvents = context.schedule?.events.filter(e => e.kind === 'TASK' && e.taskId === task.id && e.date === tomorrow) ?? [];
      return { task, goal, deadline, existingEvents, reason: `${goal ? '推进长期方向：'+goal.title : '独立待办'}；优先级 ${task.priority}${deadline ? '；目标日期 '+deadline : '；无明确截止日期'}。${task.estimatedMinutes ? '' : '缺少预计时长，需先补充。'}` };
    }).sort((a,b) => priorities.indexOf(a.task.priority)-priorities.indexOf(b.task.priority) || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.task.createdAt.localeCompare(b.task.createdAt));
    return { period, tomorrow, context, recommendations };
  }
  async propose(taskId: string, startTime: string, endTime: string, preference: string) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)
      || startTime < '08:00' || endTime > '22:00' || startTime >= endTime) throw new Error('请明确明天08:00–22:00内的可用起止时间');
    const facts = await this.read(); const item = facts.recommendations.find(r => r.task.id === taskId);
    if (!item || !item.task.estimatedMinutes || item.task.estimatedMinutes > calendarMinutes(endTime)-calendarMinutes(startTime)) throw new Error('该任务缺少时长或超出可用时间');
    const result = await this.time.proposeSchedule(taskId, `${facts.tomorrow}，只在 ${startTime}–${endTime} 可用窗口内安排任务。${item.reason} 用户偏好：${preference}`,undefined,declaredAvailabilitySchema.parse({date:facts.tomorrow,startTime,endTime}));
    if (result.proposal.after.date !== facts.tomorrow || result.proposal.after.startTime < startTime || result.proposal.after.endTime > endTime) {
      if (result.operation && this.time.canCancel) await this.time.cancel(result.operation);
      throw new Error('建议超出用户明确可用窗口，未执行');
    }
    return result;
  }
}
