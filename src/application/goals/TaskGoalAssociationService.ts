import { assignedWeeklyGoalId } from '@/domain/tasks/goalAssignment';
import type { GrowthStore } from '@/application/data/GrowthStore';
import type { Task } from '@/domain/tasks/types';

/** Existing identities only: assignment never creates tasks or schedule records. */
export class TaskGoalAssociationService {
  constructor(private readonly store: GrowthStore) {}
  async read(journeyId: string) {
    if ((await this.store.getJourney())?.id !== journeyId) throw new Error('数据空间已变化');
    if (!this.store.scheduleEvents) throw new Error('日程数据尚未验证');
    const [goals, periods] = await Promise.all([this.store.listLongTermGoals(journeyId), this.store.listPeriods(journeyId)]);
    const groups = await Promise.all(periods.map(async period => {
      const [tasks, parents, weekly, events] = await Promise.all([
        this.store.listTasks({ periodId: period.id }), this.store.listPeriodGoals(period.id),
        this.store.listWeeklyGoals(period.id), this.store.scheduleEvents!.queryByDateRange({ periodId: period.id, startDate: period.startDate, endDate: period.endDate }),
      ]);
      return { period, tasks, parents, weekly, events };
    }));
    return { goals, groups, rows: groups.flatMap(group => group.tasks.map(task => {
      const parent = group.parents.find(p => p.id === (task.periodGoalId ?? group.weekly.find(w => w.id === task.weeklyGoalId)?.periodGoalId));
      return { task, period: group.period, parent, originalGoalId: parent?.longTermGoalId ?? null, goal: goals.find(g => g.id === parent?.longTermGoalId), events: group.events.filter(e => e.taskId === task.id) };
    })) };
  }
  async assign(journeyId: string, goalId: string, expected: Task, parentId: string | null,
    confirmations: { confirmedWeeklyGoalChange?: boolean; confirmedDirectionMigration?: boolean } = {}) {
    if (!this.store.assignTaskGoal) throw new Error('当前数据源不支持关联');
    const facts = await this.read(journeyId);
    const row = facts.rows.find(r => r.task.id === expected.id && r.period.id === expected.periodId);
    if (!row || row.task.periodGoalId !== expected.periodGoalId || row.task.weeklyGoalId !== expected.weeklyGoalId || row.task.status !== expected.status) throw new Error('任务归属已变化，请重新读取');
    if (parentId) {
      if (!facts.goals.some(g => g.id === goalId && g.status !== 'ARCHIVED')) throw new Error('长期方向不可用');
      const parent = facts.groups.flatMap(g => g.parents).find(p => p.id === parentId && p.periodId === row.period.id && p.longTermGoalId === goalId && ['ACTIVE','PLANNED'].includes(p.status));
      if (!parent) throw new Error('请先在任务所属阶段创建有效阶段目标');
      if (row.originalGoalId && row.originalGoalId !== goalId && confirmations.confirmedDirectionMigration !== true) throw new Error('请明确确认从原方向迁移');
    } else if (row.originalGoalId !== goalId) throw new Error('只能解除当前方向的关联');
    const weekly = facts.groups.find(g => g.period.id===expected.periodId)?.weekly.find(w=>w.id===expected.weeklyGoalId);
    const nextWeekly = assignedWeeklyGoalId(expected,parentId,weekly);
    if (expected.weeklyGoalId && !nextWeekly && confirmations.confirmedWeeklyGoalChange !== true) throw new Error('请明确确认解除原周目标关系后再迁移或解除关联');
    if (expected.periodGoalId === parentId && expected.weeklyGoalId === nextWeekly) return;
    await this.store.assignTaskGoal(expected, parentId);
  }
}
