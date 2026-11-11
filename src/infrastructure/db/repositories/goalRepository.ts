import { goalPlanningSchema, type GoalPlanning } from '@/domain/goals/progress';
import type { CreateLongTermGoalInput, LongTermGoal } from '@/domain/goals/types';
import { isIsoDate } from '@/shared/date';
import { createId } from '@/shared/id';
import type { DatabaseLike } from '../types';
import { exclusiveWrite } from '../exclusiveWrite';

type GoalRow = {
  planning_json?: string | null;
  id: string;
  journey_id: string;
  title: string;
  description: string | null;
  category: LongTermGoal['category'];
  start_date: string;
  target_description: string;
  status: LongTermGoal['status'];
  created_at: string;
  updated_at: string;
};

function mapGoal(row: GoalRow): LongTermGoal {
  return {
    ...(row.planning_json ? { planning: goalPlanningSchema.parse(JSON.parse(row.planning_json)) } : {}),
    id: row.id,
    journeyId: row.journey_id,
    title: row.title,
    description: row.description,
    category: row.category,
    startDate: row.start_date,
    targetDescription: row.target_description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listLongTermGoals(
  db: DatabaseLike,
  journeyId: string,
  includeArchived = false,
): Promise<LongTermGoal[]> {
  const rows = await db.getAllAsync<GoalRow>(
    `SELECT * FROM long_term_goal
     WHERE journey_id = ? ${includeArchived ? '' : "AND status != 'ARCHIVED'"}
     ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END, created_at`,
    journeyId,
  );
  return rows.map(mapGoal);
}

export async function createLongTermGoal(
  db: DatabaseLike,
  input: CreateLongTermGoalInput,
): Promise<LongTermGoal> {
  if (!input.title.trim()) throw new Error('请输入长期目标名称');
  if (!input.targetDescription.trim()) throw new Error('请描述你真正想达到的状态');
  if (!isIsoDate(input.startDate)) throw new Error('开始日期格式应为 YYYY-MM-DD');

  if (input.planning) { const value = goalPlanningSchema.parse(input.planning); if (value.endDate && value.endDate < input.startDate) throw new Error('目标结束日期不能早于开始日期'); }
  const id = createId('goal');
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO long_term_goal
      (id, journey_id, title, description, category, start_date, target_description,
       status, created_at, updated_at, planning_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    id,
    input.journeyId,
    input.title.trim(),
    input.description?.trim() || null,
    input.category,
    input.startDate,
    input.targetDescription.trim(),
    now,
    now,
    input.planning ? JSON.stringify(goalPlanningSchema.parse(input.planning)) : null,
  );

  const row = await db.getFirstAsync<GoalRow>('SELECT * FROM long_term_goal WHERE id = ?', id);
  if (!row) throw new Error('长期目标创建失败');
  return mapGoal(row);
}

export async function updateGoalPlanning(db: DatabaseLike, journeyId: string, goalId: string, input: GoalPlanning, expectedUpdatedAt: string) {
  const planning = goalPlanningSchema.parse(input);
  await exclusiveWrite(db, async tx => {
    const row = await tx.getFirstAsync<GoalRow>('SELECT * FROM long_term_goal WHERE id = ?', goalId);
    if (!row || row.journey_id !== journeyId || row.updated_at !== expectedUpdatedAt) throw new Error('目标已变化，请重新读取');
    if (planning.endDate && planning.endDate < row.start_date) throw new Error('目标结束日期不能早于开始日期');
    const result = await tx.runAsync('UPDATE long_term_goal SET planning_json = ?, updated_at = ? WHERE id = ? AND journey_id = ? AND updated_at = ?', JSON.stringify(planning), new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1)).toISOString(), goalId, journeyId, expectedUpdatedAt);
    if ((result as { changes?: number } | null)?.changes !== 1) throw new Error('目标已变化，请重新读取');
  });
}
