import type { Task } from './types';
import type { WeeklyGoal } from '../goals/planningTypes';

export function assignedWeeklyGoalId(task: Task, parentId: string | null, weekly: WeeklyGoal | null | undefined) {
  if (!task.weeklyGoalId) return null;
  if (!weekly || weekly.id !== task.weeklyGoalId || weekly.periodId !== task.periodId
    || task.periodGoalId && task.periodGoalId !== weekly.periodGoalId) throw new Error('原周目标关系无效，请先核对数据');
  return parentId === weekly.periodGoalId ? weekly.id : null;
}
