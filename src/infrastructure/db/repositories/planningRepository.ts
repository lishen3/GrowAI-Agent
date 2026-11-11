import { exclusiveWrite } from '../exclusiveWrite';
import { createId } from '@/shared/id';
import {
  initialPlanSeedSchema,
  mapInitialPlanSeed,
  planInitialPlanMerge,
} from '@/application/data/initialPlanSeed';
import type {
  InitialPlanImportResult,
  PeriodGoal,
  WeeklyGoal,
} from '@/domain/goals/planningTypes';
import { getJourney } from './journeyRepository';
import { listLongTermGoals } from './goalRepository';
import { listPeriods } from './periodRepository';
import type { DatabaseLike } from '../types';

type PeriodGoalRow = {
  id: string;
  period_id: string;
  long_term_goal_id: string | null;
  title: string;
  description: string | null;
  category: PeriodGoal['category'];
  priority: PeriodGoal['priority'];
  status: PeriodGoal['status'];
  success_criteria: string | null;
  learning_path_json: string;
  created_at: string;
  completed_at: string | null;
};

type WeeklyGoalRow = {
  id: string;
  period_id: string;
  period_goal_id: string;
  week_index: number;
  title: string;
  description: string | null;
  category: WeeklyGoal['category'];
  priority: WeeklyGoal['priority'];
  target_value: number | null;
  target_unit: string | null;
  success_criteria: string | null;
  status: WeeklyGoal['status'];
  created_at: string;
  completed_at: string | null;
};

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [value];
  } catch {
    return [value];
  }
}

function mapPeriodGoal(row: PeriodGoalRow): PeriodGoal {
  return {
    id: row.id,
    periodId: row.period_id,
    longTermGoalId: row.long_term_goal_id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    successCriteria: parseStringArray(row.success_criteria),
    learningPath: parseStringArray(row.learning_path_json),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapWeeklyGoal(row: WeeklyGoalRow): WeeklyGoal {
  return {
    id: row.id,
    periodId: row.period_id,
    periodGoalId: row.period_goal_id,
    weekIndex: row.week_index,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    targetValue: row.target_value,
    targetUnit: row.target_unit,
    successCriteria: parseStringArray(row.success_criteria),
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function listPeriodGoals(db: DatabaseLike, periodId: string): Promise<PeriodGoal[]> {
  const rows = await db.getAllAsync<PeriodGoalRow>(
    `SELECT * FROM period_goal WHERE period_id = ?
     ORDER BY CASE priority WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, created_at`,
    periodId,
  );
  return rows.map(mapPeriodGoal);
}

export async function listWeeklyGoals(
  db: DatabaseLike,
  periodId: string,
  weekIndex?: number,
): Promise<WeeklyGoal[]> {
  const rows = weekIndex === undefined
    ? await db.getAllAsync<WeeklyGoalRow>(
      `SELECT * FROM weekly_goal WHERE period_id = ?
       ORDER BY week_index, CASE priority WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, created_at`,
      periodId,
    )
    : await db.getAllAsync<WeeklyGoalRow>(
      `SELECT * FROM weekly_goal WHERE period_id = ? AND week_index = ?
       ORDER BY CASE priority WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, created_at`,
      periodId,
      weekIndex,
    );
  return rows.map(mapWeeklyGoal);
}

async function listAllPeriodGoals(db: DatabaseLike): Promise<PeriodGoal[]> {
  return (await db.getAllAsync<PeriodGoalRow>('SELECT * FROM period_goal')).map(mapPeriodGoal);
}

async function listAllWeeklyGoals(db: DatabaseLike): Promise<WeeklyGoal[]> {
  return (await db.getAllAsync<WeeklyGoalRow>('SELECT * FROM weekly_goal')).map(mapWeeklyGoal);
}

export async function importInitialPlanSeed(
  db: DatabaseLike,
  input: unknown,
): Promise<InitialPlanImportResult> {
  initialPlanSeedSchema.parse(input);
  const importedAt = new Date().toISOString();
  let result: InitialPlanImportResult | null = null;

  await db.withTransactionAsync(async () => {
    const journey = await getJourney(db);
    if (!journey) throw new Error('成长旅程不存在');
    const mapped = mapInitialPlanSeed(input, journey.id, importedAt);
    const [periods, longTermGoals, periodGoals, weeklyGoals] = await Promise.all([
      listPeriods(db, journey.id),
      listLongTermGoals(db, journey.id, true),
      listAllPeriodGoals(db),
      listAllWeeklyGoals(db),
    ]);
    const plan = planInitialPlanMerge(mapped.data, {
      journey, periods, longTermGoals, periodGoals, weeklyGoals,
    });

    for (const period of plan.periodsToInsert) {
      await db.runAsync(
        `INSERT INTO period
          (id, journey_id, name, type, start_date, end_date, status, description,
           week_starts_on, current_week_override, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        period.id, period.journeyId, period.name, period.type, period.startDate, period.endDate,
        period.status, period.description, period.weekStartsOn, period.currentWeekOverride,
        period.createdAt, period.completedAt,
      );
    }

    for (const goal of plan.longTermGoalsToInsert) {
      await db.runAsync(
        `INSERT INTO long_term_goal
          (id, journey_id, title, description, category, start_date, target_description,
           status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        goal.id, goal.journeyId, goal.title, goal.description, goal.category, goal.startDate,
        goal.targetDescription, goal.status, goal.createdAt, goal.updatedAt,
      );
    }

    for (const goal of plan.periodGoalsToInsert) {
      await db.runAsync(
        `INSERT INTO period_goal
          (id, period_id, long_term_goal_id, title, description, category, priority, status,
           success_criteria, learning_path_json, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        goal.id, goal.periodId, goal.longTermGoalId, goal.title, goal.description, goal.category,
        goal.priority, goal.status, JSON.stringify(goal.successCriteria), JSON.stringify(goal.learningPath),
        goal.createdAt, goal.completedAt,
      );
    }

    for (const goal of plan.weeklyGoalsToInsert) {
      await db.runAsync(
        `INSERT INTO weekly_goal
          (id, period_id, period_goal_id, week_index, title, description, category, priority,
           target_value, target_unit, success_criteria, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        goal.id, goal.periodId, goal.periodGoalId, goal.weekIndex, goal.title, goal.description,
        goal.category, goal.priority, goal.targetValue, goal.targetUnit,
        JSON.stringify(goal.successCriteria), goal.status, goal.createdAt, goal.completedAt,
      );
    }

    if (plan.setAsCurrentPeriod) {
      await db.runAsync(
        'UPDATE growth_journey SET current_period_id = ?, updated_at = ? WHERE id = ?',
        plan.periodId,
        importedAt,
        journey.id,
      );
    }
    result = plan.result;
  });

  if (!result) throw new Error('初始规划导入失败');
  return result;
}

export async function createPeriodGoal(db: DatabaseLike,periodId:string,goalId:string,title:string):Promise<PeriodGoal>{
 if(!title.trim() || title.length>200)throw new Error('阶段目标名称应为1–200字');
 let row!:PeriodGoal;
 await exclusiveWrite(db,async tx=>{
  const db=tx;
  const valid=await db.getFirstAsync<{category:PeriodGoal['category']}>("SELECT g.category FROM period p JOIN long_term_goal g ON g.journey_id=p.journey_id WHERE p.id=? AND g.id=? AND g.status!='ARCHIVED'",periodId,goalId);
  if(!valid)throw new Error('阶段与长期方向归属无效');
  row={id:createId('period-goal'),periodId,longTermGoalId:goalId,title:title.trim(),description:null,category:valid.category,priority:'B',status:'ACTIVE',successCriteria:[],learningPath:[],createdAt:new Date().toISOString(),completedAt:null};
  await db.runAsync("INSERT INTO period_goal (id,period_id,long_term_goal_id,title,description,category,priority,status,success_criteria,learning_path_json,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",row.id,periodId,goalId,row.title,null,row.category,'B','ACTIVE','[]','[]',row.createdAt,null);
 });return row;
}
