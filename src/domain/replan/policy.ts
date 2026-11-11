import type { AgentAction } from '@/domain/agent/actions';
import { agentActionSchema } from '@/domain/agent/actions';
import type { AgentContext } from '@/domain/agent/types';

export function validateReplanActions(context: AgentContext, actions: AgentAction[]): void {
  const updated = new Set<string>();
  for (const input of actions) {
    const action = agentActionSchema.parse(input);
    const args = action.toolName === 'update_task' ? action.arguments.changes : action.arguments;
    if (args.estimatedMinutes === 0) throw new Error('重排不能用零时长模拟删除任务');
    if (args.plannedDate !== undefined && (args.plannedDate < context.currentWeek.windowStart
      || args.plannedDate > context.currentWeek.windowEnd)) throw new Error('当前版本只重排本周任务');
    if (action.toolName === 'update_task') {
      const task = context.tasks.find((item) => item.id === action.arguments.taskId);
      if (!task || !['TODO', 'DOING', 'DELAYED'].includes(task.status)) throw new Error('只能重排当前上下文中未完成的任务');
      if (updated.has(task.id)) throw new Error('同一任务不能包含多个重排操作');
      updated.add(task.id);
    } else {
      if (!action.arguments.plannedDate) throw new Error('新增重排任务必须指定本周日期');
      if (action.arguments.weeklyGoalId && !context.weeklyGoals.some((goal) => goal.id === action.arguments.weeklyGoalId)) {
        throw new Error('周目标不在当前上下文中');
      }
    }
  }
}
