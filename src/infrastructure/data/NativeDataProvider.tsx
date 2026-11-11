import { projectCoursesForWeek } from '@/domain/courses/projectCourseWeek';
import { sameManualPlacement, scheduleEventSchema } from '@/domain/scheduling/types';
import { assertSameTaskCreation } from '@/domain/tasks/creationRequest';
import type { GrowthSnapshot, GrowthStore } from '@/application/data/GrowthStore';
import { confirmedInitialPlanSeed } from '@/application/data/confirmedInitialPlan';
import { ensureJourney, getJourney, setCurrentPeriod } from '@/infrastructure/db/repositories/journeyRepository';
import { createLongTermGoal, listLongTermGoals, updateGoalPlanning } from '@/infrastructure/db/repositories/goalRepository';
import { createPeriod, listPeriods } from '@/infrastructure/db/repositories/periodRepository';
import {
  createPeriodGoal,
  importInitialPlanSeed,
  listPeriodGoals,
  listWeeklyGoals,
} from '@/infrastructure/db/repositories/planningRepository';
import { migrateDatabase } from '@/infrastructure/db/migrations';
import { correctNativeWeekStarts } from './mondayWeekMigration';
import { createSQLitePersonalConversion } from '@/infrastructure/db/repositories/personalConversionRepository';
import { createSQLiteCategoryRepository } from '@/infrastructure/db/repositories/categoryRepository';
import { createSQLiteConversationRepository } from '@/infrastructure/db/repositories/conversationRepository';
import { createSQLiteMemoryRepository } from '@/infrastructure/db/repositories/memoryRepository';
import { createSQLiteScheduleEventRepository } from '@/infrastructure/db/repositories/scheduleEventRepository';
import { createSQLiteCourseRepository } from '@/infrastructure/db/repositories/courseRepository';
import {
  assignTaskGoal,
  completeTask,
  createTask,
  updateTask,
  updateTaskDateOnly,
  getTask,
  listAchievements,
  listTaskExecutions,
  listExecutions,
  listTasks,
} from '@/infrastructure/db/repositories/taskRepository';
import { SQLiteProvider, type SQLiteDatabase, useSQLiteContext } from 'expo-sqlite';
import { useMemo, type PropsWithChildren } from 'react';
import { DataContext } from './DataContext';
import { requestRecordId } from '@/shared/id';

async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
  await migrateDatabase(db);
  await correctNativeWeekStarts(db);
  await ensureJourney(db);
  try {
    await importInitialPlanSeed(db, confirmedInitialPlanSeed);
  } catch (error) {
    console.error('GrowAI 初始规划导入失败，已保留现有数据。', error);
  }
}

function NativeStoreBridge({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const store = useMemo<GrowthStore>(() => ({
    async getContextVersion() {
      const version = await db.getFirstAsync<{ local: number; external: number }>(
        'SELECT total_changes() AS local, data_version AS external FROM pragma_data_version');
      if (!version) throw new Error('无法核对数据版本，请重新读取');
      return JSON.stringify(version);
    },
    categories: createSQLiteCategoryRepository(db),
    conversations: createSQLiteConversationRepository(db),
    convertPersonalEvent: createSQLitePersonalConversion(db),
    scheduleEvents: createSQLiteScheduleEventRepository(db),
    courses: createSQLiteCourseRepository(db),
    ...createSQLiteMemoryRepository(db),
    getJourney: () => getJourney(db),
    listPeriods: (journeyId) => listPeriods(db, journeyId),
    listLongTermGoals: (journeyId) => listLongTermGoals(db, journeyId),
    listPeriodGoals: (periodId) => listPeriodGoals(db, periodId),
    listWeeklyGoals: (periodId, weekIndex) => listWeeklyGoals(db, periodId, weekIndex),
    createPeriod: (input) => createPeriod(db, input),
    setCurrentPeriod: (journeyId, periodId) => setCurrentPeriod(db, journeyId, periodId),
    updateGoalPlanning: (journeyId, goalId, input, expected) => updateGoalPlanning(db, journeyId, goalId, input, expected),
    createLongTermGoal: (input) => createLongTermGoal(db, input),
    importInitialPlanSeed: (input) => importInitialPlanSeed(db, input),
    listTasks: (query) => listTasks(db, query),
    createPeriodGoal: (periodId, goalId, title) => createPeriodGoal(db,periodId,goalId,title),
    assignTaskGoal: (expected, periodGoalId) => assignTaskGoal(db, expected, periodGoalId),
    getTask: (taskId) => getTask(db, taskId),
    createScheduledTaskAtomic: async (input, slot, requestId) => {
      let result!: { task: import('@/domain/tasks/types').Task; event: import('@/domain/scheduling/types').ScheduleEvent };
      await db.withExclusiveTransactionAsync(async tx => {
        const scoped: import('@/infrastructure/db/types').DatabaseLike = {
          execAsync: sql => tx.execAsync(sql), runAsync: (sql, ...args) => tx.runAsync(sql, ...args as any[]),
          getFirstAsync: (sql, ...args) => tx.getFirstAsync(sql, ...args as any[]), getAllAsync: (sql, ...args) => tx.getAllAsync(sql, ...args as any[]),
          withTransactionAsync: async work => { await work(); },
        };
        const id = requestRecordId('task',requestId), eventId = requestRecordId('schedule',requestId);
        const previous = await getTask(scoped,id);
        const task = await createTask(scoped,input,id);
        const event = scheduleEventSchema.parse({ id:eventId,periodId:task.periodId,taskId:task.id,type:'TASK',source:'USER',title:task.title,...(task.categoryId ? {categoryId:task.categoryId}:{}),...slot });
        const repository = createSQLiteScheduleEventRepository(scoped);
        const existing = await scoped.getFirstAsync<{record_json:string}>('SELECT record_json FROM schedule_event WHERE id=?',eventId);
        if (previous) {
          assertSameTaskCreation(previous,input);
          if (!existing || !sameManualPlacement(JSON.parse(existing.record_json),event)) throw new Error('CREATION_REQUEST_CHANGED');
          result={task,event:scheduleEventSchema.parse(JSON.parse(existing.record_json))}; return;
        }
        const period = (await listPeriods(scoped,(await getJourney(scoped))!.id)).find(row=>row.id===task.periodId);
        if (!period) throw new Error('阶段不存在');
        const rows = await repository.queryByDateRange({periodId:task.periodId,startDate:slot.date,endDate:slot.date});
        const courses = await createSQLiteCourseRepository(scoped).list(task.periodId);
        const fixed = projectCoursesForWeek(courses,slot.date,slot.date,{periodStart:period.startDate,weekStartsOn:period.weekStartsOn});
        if ([...rows,...fixed].some(row=>row.startTime<slot.endTime && slot.startTime<row.endTime)) throw new Error('时间冲突，创建失败');
        result={task,event:await repository.create(event,requestId)};
      }); return result;
    },
    createTask: async (input, requestId) => {
      let result!: Awaited<ReturnType<typeof createTask>>;
      await db.withTransactionAsync(async () => {
        result = await createTask(db, input, requestId ? requestRecordId('task', requestId) : undefined);
      });
      return result;
    },
    updateTask: (input) => updateTask(db, input),
    updateTaskDateOnly: (input) => updateTaskDateOnly(db, input),
    completeTask: (input) => completeTask(db, input),
    listTaskExecutions: (taskId) => listTaskExecutions(db, taskId),
    listExecutions: (query) => listExecutions(db, query),
    listAchievements: (query) => listAchievements(db, query),
    exportSnapshot: async (): Promise<GrowthSnapshot> => {
      let snapshot!: GrowthSnapshot;
      await db.withExclusiveTransactionAsync(async db => {
      const journey = await getJourney(db);
      if (!journey) throw new Error('成长旅程不存在');
      const [periods, goals] = await Promise.all([
        listPeriods(db, journey.id),
        listLongTermGoals(db, journey.id),
      ]);
      const [periodGoals, weeklyGoals, tasks, achievements] = await Promise.all([
        Promise.all(periods.map((period) => listPeriodGoals(db, period.id))).then((items) => items.flat()),
        Promise.all(periods.map((period) => listWeeklyGoals(db, period.id))).then((items) => items.flat()),
        Promise.all(periods.map((period) => listTasks(db, { periodId: period.id }))).then((items) => items.flat()),
        listAchievements(db, { journeyId: journey.id }),
      ]);
      const taskExecutions = (await Promise.all(
        tasks.map((task) => listTaskExecutions(db, task.id)),
      )).flat();
      snapshot = {
        schemaVersion: 6,
        categories: await createSQLiteCategoryRepository(db).list(journey.id),
        scheduleEvents: (await Promise.all(periods.map((period) => createSQLiteScheduleEventRepository(db).queryByDateRange({
          periodId: period.id, startDate: period.startDate, endDate: period.endDate,
        })))).flat(),
        courses: (await Promise.all(periods.map((period) => createSQLiteCourseRepository(db).list(period.id)))).flat(),
        exportedAt: new Date().toISOString(),
        journey,
        periods,
        goals,
        periodGoals,
        weeklyGoals,
        tasks,
        taskExecutions,
        achievements,
        memories: await createSQLiteMemoryRepository(db).listMemories(journey.id),
        reflections: await createSQLiteMemoryRepository(db).listReflections(journey.id),
      };
      });
      return snapshot;
    },
  }), [db]);

  return <DataContext.Provider value={store}>{children}</DataContext.Provider>;
}

export function NativeDataProvider({ children }: PropsWithChildren) {
  return (
    <SQLiteProvider databaseName="growai.db" onInit={initializeDatabase} useSuspense>
      <NativeStoreBridge>{children}</NativeStoreBridge>
    </SQLiteProvider>
  );
}
