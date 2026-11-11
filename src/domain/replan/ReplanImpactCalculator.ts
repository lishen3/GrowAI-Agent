import type { AgentAction } from '@/domain/agent/actions';
import type { AgentContext } from '@/domain/agent/types';
import { validateReplanActions } from './policy';

export function calculateReplanImpact(context: AgentContext, actions: AgentAction[]) {
  validateReplanActions(context, actions);
  const before = context.tasks.filter((task) => task.status !== 'CANCELLED');
  const durations = new Map(before.map((task) => [task.id, task.estimatedMinutes]));
  const additions: Array<number | null> = [];
  for (const action of actions) {
    if (action.toolName === 'create_task') additions.push(action.arguments.estimatedMinutes ?? null);
    else if (action.arguments.changes.estimatedMinutes !== undefined) {
      durations.set(action.arguments.taskId, action.arguments.changes.estimatedMinutes);
    }
  }
  const total = (values: Array<number | null>) => values.length === 0 || values.some((value) => value === null)
    ? null : values.reduce<number>((sum, value) => sum + value!, 0);
  return { beforePlannedMinutes: total(before.map((task) => task.estimatedMinutes)),
    afterPlannedMinutes: total([...durations.values(), ...additions]), affectedTaskCount: actions.length };
}
