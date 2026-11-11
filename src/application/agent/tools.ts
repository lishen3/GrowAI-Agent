import { z } from 'zod';
import { createTaskArgumentsSchema, updateTaskArgumentsSchema } from '@/domain/agent/actions';
import type { Task } from '@/domain/tasks/types';
import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute(arguments_: unknown, periodId: string): Promise<Task>;
}

export function createToolRegistry(tasks: TaskApplicationService): ReadonlyMap<string, ToolDefinition> {
  return new Map<string, ToolDefinition>([
    ['create_task', {
      name: 'create_task', description: '新增待办计划任务', inputSchema: createTaskArgumentsSchema,
      execute: (arguments_, periodId) => tasks.createTask({
        ...createTaskArgumentsSchema.parse(arguments_), periodId, priority: 'B',
      }),
    }],
    ['update_task', {
      name: 'update_task', description: '修改现有任务的计划字段', inputSchema: updateTaskArgumentsSchema,
      async execute(arguments_, periodId) {
        const input = updateTaskArgumentsSchema.parse(arguments_);
        const task = await tasks.getTask(input.taskId);
        if (!task || task.periodId !== periodId) throw new Error('任务不存在或不属于建议的阶段');
        return tasks.updateTask(input);
      },
    }],
  ]);
}
