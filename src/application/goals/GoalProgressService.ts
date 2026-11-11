import { goalProgress, goalDeadline } from '@/domain/goals/progress';
import { todayIso } from '@/shared/date';
import type { GrowthStore } from '@/application/data/GrowthStore';
export class GoalProgressService {
  constructor(private readonly store: GrowthStore) {}
  async list(journeyId: string) {
    const journey = await this.store.getJourney();
    if (journey?.id !== journeyId) throw new Error('成长旅程不匹配');
    const [goals, periods] = await Promise.all([this.store.listLongTermGoals(journeyId), this.store.listPeriods(journeyId)]);
    const facts = await Promise.all(periods.map(async period => ({
      period, periodGoals: await this.store.listPeriodGoals(period.id), weeklyGoals: await this.store.listWeeklyGoals(period.id),
      tasks: await this.store.listTasks({ periodId: period.id }), executions: await this.store.listExecutions({ periodId: period.id }),
    })));
    const [achievementRows, reflections] = await Promise.all([this.store.listAchievements({ journeyId }), this.store.listReflections(journeyId)]);
    return goals.map(goal => {
      const linked = facts.flatMap(fact => {
        const pgIds = new Set(fact.periodGoals.filter(pg => pg.periodId === fact.period.id && pg.longTermGoalId === goal.id).map(pg => pg.id));
        const wgIds = new Set(fact.weeklyGoals.filter(wg => wg.periodId === fact.period.id && pgIds.has(wg.periodGoalId)).map(wg => wg.id));
        return fact.tasks.filter(task => task.periodId === fact.period.id
          && (task.periodGoalId ? pgIds.has(task.periodGoalId) : task.weeklyGoalId !== null && wgIds.has(task.weeklyGoalId)));
      });
      const tasks = [...new Map(linked.map(task => [task.id, task])).values()];
      const ids = new Set(tasks.map(task => task.id));
      const executions = [...new Map(facts.flatMap(fact => fact.executions).filter(row => ids.has(row.taskId)).map(row => [row.id,row])).values()];
      const missing = tasks.some(task => task.status === 'DONE' && !executions.some(row => row.taskId === task.id))
        || executions.some(row => row.actualMinutes === null);
      const achievements = [...new Map(achievementRows.filter(row => row.journeyId === journeyId && row.sourceType === 'TASK'
        && tasks.some(task => task.id === row.sourceId && task.periodId === row.periodId)).map(row => [row.id,row])).values()]
        .sort((a,b) => b.occurredAt.localeCompare(a.occurredAt));
      return { goal, tasks, stages: facts.flatMap(fact=>fact.periodGoals.filter(pg=>pg.longTermGoalId===goal.id)), progress: goalProgress(goal.planning), deadline: goalDeadline(goal.planning?.endDate, todayIso()), taskCount: tasks.length, completedTaskCount: tasks.filter(task => task.status === 'DONE').length,
        actualMinutes: !executions.length || missing ? null : executions.reduce((sum,row) => sum + row.actualMinutes!,0),
        achievements, periodReflections: reflections.filter(row => row.journeyId === journeyId && tasks.some(task => task.periodId === row.periodId)) };
    });
  }
}
