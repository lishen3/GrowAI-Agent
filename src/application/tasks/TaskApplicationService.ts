import { assertTaskCanUpdate, validateCompleteTask, validateCreateTask, validateUpdateTask } from '@/domain/tasks/rules';
import { resolveTaskGoalLinks } from './taskGoalLinks';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { assertDateOnlyBefore, dateOnlyUpdateSchema, type DateOnlyUpdateInput } from '@/domain/tasks/dateOnly';
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

export interface TaskGateway {
  listTasks(query: TaskQuery): Promise<Task[]>;
  getTask(taskId: string): Promise<Task | null>;
  createTask(input: CreateTaskInput, requestId?: string): Promise<Task>;
  updateTask(input: UpdateTaskInput): Promise<Task>;
  updateTaskDateOnly?(input: DateOnlyUpdateInput): Promise<Task>;
  completeTask(input: CompleteTaskInput): Promise<TaskCompletionResult>;
  listTaskExecutions(taskId: string): Promise<TaskExecution[]>;
  listExecutions(query: TaskExecutionQuery): Promise<TaskExecution[]>;
  listAchievements(query: AchievementQuery): Promise<Achievement[]>;
}

export class TaskApplicationService {
  constructor(private readonly gateway: TaskGateway) {}

  listTasks(query: TaskQuery) { return this.gateway.listTasks(query); }
  getTask(taskId: string) { return this.gateway.getTask(taskId); }
  listTaskExecutions(taskId: string) { return this.gateway.listTaskExecutions(taskId); }
  listExecutions(query: TaskExecutionQuery) { return this.gateway.listExecutions(query); }
  listAchievements(query: AchievementQuery) { return this.gateway.listAchievements(query); }

  createTask(input: CreateTaskInput, requestId?: string) {
    validateCreateTask(input);
    const create = (value: CreateTaskInput) => requestId ? this.gateway.createTask(value, requestId) : this.gateway.createTask(value);
    if (!input.periodGoalId && !input.weeklyGoalId) return create(input);
    const store = this.gateway as GrowthStore;
    if (!store.listPeriodGoals || !store.listWeeklyGoals || !store.listLongTermGoals || !store.getJourney || !store.listPeriods) throw new Error('数据源不支持目标归属校验');
    return resolveTaskGoalLinks(store, input).then(create);
  }

  completeTask(input: CompleteTaskInput) {
    validateCompleteTask(input);
    return this.gateway.completeTask(input);
  }

  async updateTask(input: UpdateTaskInput) {
    validateUpdateTask(input);
    const task = await this.gateway.getTask(input.taskId);
    if (!task) throw new Error('任务不存在');
    assertTaskCanUpdate(task);
    return this.gateway.updateTask(input);
  }

  async updateTaskDateOnly(input: DateOnlyUpdateInput): Promise<Task> {
    const validated = dateOnlyUpdateSchema.parse(input);
    assertDateOnlyBefore(await this.gateway.getTask(validated.taskId), validated);
    if (!this.gateway.updateTaskDateOnly) throw new Error('DATE_ONLY_GATEWAY_UNAVAILABLE');
    return this.gateway.updateTaskDateOnly(validated);
  }
}
