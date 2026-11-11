import { exclusiveWrite } from '../exclusiveWrite';
import { assignedWeeklyGoalId } from '@/domain/tasks/goalAssignment';
import { assertTaskCanComplete, assertTaskCanUpdate, validateCompleteTask, validateCreateTask, validateUpdateTask } from '@/domain/tasks/rules';
import type {
  Achievement,
  AchievementQuery,
  CompleteTaskInput,
  CreateTaskInput,
  Task,
  TaskCompletionResult,
  TaskExecution,
  TaskExecutionQuery,
  TaskQuery,
  UpdateTaskInput,
} from '@/domain/tasks/types';
import { requireNativeCategory } from './categoryRepository';
import { legacyCategoryForId } from '@/domain/categories/types';
import { createId } from '@/shared/id';
import { assertSameTaskCreation } from '@/domain/tasks/creationRequest';
import { assertDateOnlyBefore, dateOnlyUpdateSchema, sameTask, type DateOnlyUpdateInput } from '@/domain/tasks/dateOnly';
import type { DatabaseLike } from '../types';

type TaskRow = {
  id: string; period_id: string; period_goal_id: string | null; weekly_goal_id: string | null;
  category_id?: string | null; title: string; description: string | null; category: Task['category']; priority: Task['priority'];
  status: Task['status']; planned_date: string | null; estimated_minutes: number | null; deadline: string | null;
  created_at: string; started_at: string | null; completed_at: string | null;
};
type ExecutionRow = {
  id: string; task_id: string; started_at: string | null; completed_at: string;
  planned_minutes_snapshot: number | null; actual_minutes: number | null; completion_note: string | null;
  learned: string | null; result: string | null; created_at: string;
};
type AchievementRow = {
  id: string; journey_id: string; period_id: string | null; source_type: 'TASK'; source_id: string;
  category_id?: string | null; title: string; description: string | null; category: Achievement['category']; occurred_at: string;
  planned_duration_snapshot: number | null; actual_duration: number | null;
  summary: string | null; result: string | null; is_milestone: 0 | 1; created_at: string;
};

const mapTask = (row: TaskRow): Task => ({
  ...(row.category_id && row.category_id !== row.category ? { categoryId: row.category_id } : {}),
  id: row.id, periodId: row.period_id, periodGoalId: row.period_goal_id, weeklyGoalId: row.weekly_goal_id,
  title: row.title, description: row.description, category: row.category, priority: row.priority,
  status: row.status, plannedDate: row.planned_date, estimatedMinutes: row.estimated_minutes,
  deadline: row.deadline, createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at,
});
const mapExecution = (row: ExecutionRow): TaskExecution => ({
  id: row.id, taskId: row.task_id, startedAt: row.started_at, completedAt: row.completed_at,
  plannedMinutesSnapshot: row.planned_minutes_snapshot, actualMinutes: row.actual_minutes,
  completionNote: row.completion_note, learned: row.learned, result: row.result, createdAt: row.created_at,
});
const mapAchievement = (row: AchievementRow): Achievement => ({
  ...(row.category_id && row.category_id !== row.category ? { categoryId: row.category_id } : {}),
  id: row.id, journeyId: row.journey_id, periodId: row.period_id, sourceType: row.source_type,
  sourceId: row.source_id, title: row.title, description: row.description, category: row.category,
  occurredAt: row.occurred_at, plannedDurationSnapshot: row.planned_duration_snapshot,
  actualDuration: row.actual_duration, summary: row.summary, result: row.result,
  isMilestone: row.is_milestone === 1, createdAt: row.created_at,
});

export async function listTasks(db: DatabaseLike, query: TaskQuery): Promise<Task[]> {
  const filters = ['period_id = ?'];
  const params: unknown[] = [query.periodId];
  if (query.plannedDate !== undefined) { filters.push('planned_date = ?'); params.push(query.plannedDate); }
  if (query.plannedFrom !== undefined) { filters.push('planned_date >= ?'); params.push(query.plannedFrom); }
  if (query.plannedTo !== undefined) { filters.push('planned_date <= ?'); params.push(query.plannedTo); }
  if (query.status !== undefined) { filters.push('status = ?'); params.push(query.status); }
  const rows = await db.getAllAsync<TaskRow>(
    `SELECT * FROM task WHERE ${filters.join(' AND ')}
     ORDER BY CASE priority WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, created_at`,
    ...params,
  );
  return rows.map(mapTask);
}

export async function getTask(db: Pick<DatabaseLike, 'getFirstAsync'>, taskId: string): Promise<Task | null> {
  const row = await db.getFirstAsync<TaskRow>('SELECT * FROM task WHERE id = ?', taskId);
  return row ? mapTask(row) : null;
}

export async function createTask(db: Pick<DatabaseLike, 'getFirstAsync' | 'runAsync'>, input: CreateTaskInput, stableId?: string): Promise<Task> {
  validateCreateTask(input);
  if (stableId) {
    const saved = await getTask(db, stableId);
    if (saved) { assertSameTaskCreation(saved, input); return saved; }
  }
  const period = await db.getFirstAsync<{ id: string }>('SELECT id FROM period WHERE id = ?', input.periodId);
  if (!period) throw new Error('任务所属阶段不存在');
  if (input.periodGoalId) {
    const periodGoal = await db.getFirstAsync<{ period_id: string }>(
      'SELECT period_id FROM period_goal WHERE id = ?', input.periodGoalId,
    );
    if (!periodGoal || periodGoal.period_id !== input.periodId) throw new Error('阶段目标不属于任务阶段');
  }
  if (input.weeklyGoalId) {
    const weeklyGoal = await db.getFirstAsync<{ period_id: string; period_goal_id: string }>(
      'SELECT period_id, period_goal_id FROM weekly_goal WHERE id = ?', input.weeklyGoalId,
    );
    if (!weeklyGoal || weeklyGoal.period_id !== input.periodId) throw new Error('周目标不属于任务阶段');
    if (input.periodGoalId && weeklyGoal.period_goal_id !== input.periodGoalId) {
      throw new Error('周目标与阶段目标关系不一致');
    }
  }
  if (input.categoryId) await requireNativeCategory(db, input.periodId, input.categoryId);
  const id = stableId ?? createId('task');
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO task
      (id, period_id, period_goal_id, weekly_goal_id, title, description, category, priority,
       status, planned_date, estimated_minutes, deadline, created_at, started_at, completed_at, category_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TODO', ?, ?, ?, ?, NULL, NULL, ?)`,
    id, input.periodId, input.periodGoalId ?? null, input.weeklyGoalId ?? null, input.title.trim(),
    input.description?.trim() || null, input.categoryId ? legacyCategoryForId(input.categoryId) : input.category, input.priority, input.plannedDate ?? null,
    input.estimatedMinutes ?? null, input.deadline ?? null, now, input.categoryId ?? input.category,
  );
  const task = await getTask(db, id);
  if (!task) throw new Error('任务创建失败');
  return task;
}

export async function updateTask(db: DatabaseLike, input: UpdateTaskInput): Promise<Task> {
  validateUpdateTask(input);
  let result: Task | null = null;
  await db.withTransactionAsync(async () => {
    const task = await getTask(db, input.taskId);
    if (!task) throw new Error('任务不存在');
    assertTaskCanUpdate(task);
    if (input.changes.categoryId && input.changes.categoryId !== task.categoryId) await requireNativeCategory(db, task.periodId, input.changes.categoryId);
    const updated = { ...task, ...input.changes };
    if (input.changes.categoryId) updated.category = legacyCategoryForId(input.changes.categoryId);
    updated.title = updated.title.trim();
    await db.runAsync(
      'UPDATE task SET title = ?, description = ?, planned_date = ?, estimated_minutes = ?, category_id = ?, category = ? WHERE id = ?',
      updated.title, updated.description, updated.plannedDate, updated.estimatedMinutes, updated.categoryId ?? updated.category, updated.category, task.id,
    );
    result = await getTask(db, task.id);
    if (!result) throw new Error('任务更新失败');
  });
  return result!;
}

export async function updateTaskDateOnly(db: DatabaseLike, input: DateOnlyUpdateInput): Promise<Task> {
  const validated = dateOnlyUpdateSchema.parse(input);
  let result: Task | null = null;
  await db.withTransactionAsync(async () => {
    const task = await getTask(db, validated.taskId);
    assertDateOnlyBefore(task, validated);
    await db.runAsync('UPDATE task SET planned_date = ? WHERE id = ?', validated.targetDate, task.id);
    result = await getTask(db, task.id);
    if (!result || !sameTask(result, { ...task, plannedDate: validated.targetDate })) {
      throw new Error('DATE_ONLY_TRANSACTION_READBACK_MISMATCH');
    }
  });
  return result!;
}

async function existingCompletion(db: DatabaseLike, task: Task): Promise<TaskCompletionResult | null> {
  const achievementRow = await db.getFirstAsync<AchievementRow>(
    "SELECT * FROM achievement WHERE source_type = 'TASK' AND source_id = ?", task.id,
  );
  if (!achievementRow) return null;
  const executionRow = await db.getFirstAsync<ExecutionRow>(
    'SELECT * FROM task_execution WHERE task_id = ? ORDER BY created_at DESC LIMIT 1', task.id,
  );
  if (!executionRow || task.status !== 'DONE') throw new Error('任务完成数据不一致，请先恢复数据');
  return { task, execution: mapExecution(executionRow), achievement: mapAchievement(achievementRow) };
}

export async function completeTask(
  db: DatabaseLike,
  input: CompleteTaskInput,
): Promise<TaskCompletionResult> {
  validateCompleteTask(input);
  let result: TaskCompletionResult | null = null;
  await db.withTransactionAsync(async () => {
    const task = await getTask(db, input.taskId);
    if (!task) throw new Error('任务不存在');
    const previous = await existingCompletion(db, task);
    if (previous) { result = previous; return; }
    assertTaskCanComplete(task);

    const period = await db.getFirstAsync<{ journey_id: string }>(
      'SELECT journey_id FROM period WHERE id = ?', task.periodId,
    );
    if (!period) throw new Error('任务所属阶段不存在');

    const now = new Date().toISOString();
    // Missing actual duration is unknown, not the planned estimate.
    const actualMinutes = input.actualMinutes ?? null;
    const executionId = createId('execution');
    const achievementId = createId('achievement');
    await db.runAsync(
      `INSERT INTO task_execution
        (id, task_id, started_at, completed_at, planned_minutes_snapshot, actual_minutes,
         completion_note, learned, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      executionId, task.id, task.startedAt, now, task.estimatedMinutes, actualMinutes,
      input.note?.trim() || null, input.learned?.trim() || null, input.result?.trim() || null, now,
    );
    await db.runAsync(
      `INSERT INTO achievement
        (id, journey_id, period_id, source_type, source_id, title, description, category,
         occurred_at, planned_duration_snapshot, actual_duration, summary, result, is_milestone, created_at, category_id)
       VALUES (?, ?, ?, 'TASK', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      achievementId, period.journey_id, task.periodId, task.id, task.title, task.description,
      task.category, now, task.estimatedMinutes, actualMinutes,
      input.note?.trim() || null, input.result?.trim() || null, now, task.categoryId ?? task.category,
    );
    await db.runAsync('UPDATE task SET status = ?, completed_at = ? WHERE id = ?', 'DONE', now, task.id);

    result = {
      task: { ...task, status: 'DONE', completedAt: now },
      execution: {
        id: executionId, taskId: task.id, startedAt: task.startedAt, completedAt: now,
        plannedMinutesSnapshot: task.estimatedMinutes, actualMinutes,
        completionNote: input.note?.trim() || null, learned: input.learned?.trim() || null,
        result: input.result?.trim() || null, createdAt: now,
      },
      achievement: {
        id: achievementId, journeyId: period.journey_id, periodId: task.periodId,
        sourceType: 'TASK', sourceId: task.id, title: task.title, description: task.description,
        category: task.category, ...(task.categoryId ? { categoryId: task.categoryId } : {}), occurredAt: now, plannedDurationSnapshot: task.estimatedMinutes,
        actualDuration: actualMinutes, summary: input.note?.trim() || null,
        result: input.result?.trim() || null, isMilestone: false, createdAt: now,
      },
    };
  });
  if (!result) throw new Error('任务完成失败');
  return result;
}

export async function listTaskExecutions(db: DatabaseLike, taskId: string): Promise<TaskExecution[]> {
  const rows = await db.getAllAsync<ExecutionRow>(
    'SELECT * FROM task_execution WHERE task_id = ? ORDER BY completed_at DESC', taskId,
  );
  return rows.map(mapExecution);
}

export async function listExecutions(db: DatabaseLike, query: TaskExecutionQuery): Promise<TaskExecution[]> {
  const filters = ['t.period_id = ?'];
  const params: unknown[] = [query.periodId];
  if (query.completedFrom !== undefined) {
    filters.push("date(e.completed_at, 'localtime') >= ?"); params.push(query.completedFrom);
  }
  if (query.completedTo !== undefined) {
    filters.push("date(e.completed_at, 'localtime') <= ?"); params.push(query.completedTo);
  }
  const limit = query.limit === undefined ? '' : ' LIMIT ?';
  if (query.limit !== undefined) params.push(query.limit);
  const rows = await db.getAllAsync<ExecutionRow>(
    `SELECT e.* FROM task_execution e JOIN task t ON t.id = e.task_id
     WHERE ${filters.join(' AND ')} ORDER BY e.completed_at DESC${limit}`,
    ...params,
  );
  return rows.map(mapExecution);
}

export async function listAchievements(db: DatabaseLike, query: AchievementQuery): Promise<Achievement[]> {
  const filters = ['journey_id = ?'];
  const params: unknown[] = [query.journeyId];
  if (query.periodId !== undefined) { filters.push('period_id = ?'); params.push(query.periodId); }
  if (query.occurredDate !== undefined) {
    filters.push("date(occurred_at, 'localtime') = ?"); params.push(query.occurredDate);
  }
  if (query.occurredFrom !== undefined) {
    filters.push("date(occurred_at, 'localtime') >= ?"); params.push(query.occurredFrom);
  }
  if (query.occurredTo !== undefined) {
    filters.push("date(occurred_at, 'localtime') <= ?"); params.push(query.occurredTo);
  }
  const limit = query.limit === undefined ? '' : ' LIMIT ?';
  if (query.limit !== undefined) params.push(query.limit);
  const rows = await db.getAllAsync<AchievementRow>(
    `SELECT * FROM achievement WHERE ${filters.join(' AND ')} ORDER BY occurred_at DESC${limit}`, ...params,
  );
  return rows.map(mapAchievement);
}

/** Explicit reassignment retains executions/achievements and retains a compatible weekly parent. */
export async function assignTaskGoal(db: DatabaseLike, expected: Task, periodGoalId: string | null): Promise<void> {
  await exclusiveWrite(db, async tx => {
    const db = tx;
    const task = await getTask(db, expected.id);
    if (!task || task.periodId !== expected.periodId || task.periodGoalId !== expected.periodGoalId || task.weeklyGoalId !== expected.weeklyGoalId || task.status !== expected.status) throw new Error('任务归属已变化，请重新读取');
    if (periodGoalId) {
      const valid = await db.getFirstAsync<{ id: string }>(`SELECT pg.id FROM period_goal pg JOIN period p ON p.id=pg.period_id
        LEFT JOIN long_term_goal g ON g.id=pg.long_term_goal_id
        WHERE pg.id=? AND pg.period_id=? AND pg.status!='CANCELLED'
        AND (pg.long_term_goal_id IS NULL OR (g.journey_id=p.journey_id AND g.status!='ARCHIVED'))`,periodGoalId,task.periodId);
      if (!valid) throw new Error('阶段目标归属无效');
    }
    const weekly = task.weeklyGoalId ? await db.getFirstAsync<{id:string;period_id:string;period_goal_id:string}>('SELECT id,period_id,period_goal_id FROM weekly_goal WHERE id=?',task.weeklyGoalId) : null;
    const weeklyId = assignedWeeklyGoalId(task,periodGoalId,weekly ? {id:weekly.id,periodId:weekly.period_id,periodGoalId:weekly.period_goal_id} as import('@/domain/goals/planningTypes').WeeklyGoal : null);
    await db.runAsync('UPDATE task SET period_goal_id=?, weekly_goal_id=? WHERE id=?',periodGoalId,weeklyId,task.id);
  });
}
