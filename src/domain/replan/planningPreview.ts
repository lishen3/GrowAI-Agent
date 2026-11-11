import { z } from 'zod';
import { PLANNING_CATEGORIES } from '@/domain/goals/planningTypes';
import { isoDateSchema } from '@/domain/tasks/dateOnly';
import type { AgentContext } from '@/domain/agent/types';
import type { Task } from '@/domain/tasks/types';

export type DemoPlanningSession = { sessionId: string; resetEpoch: number };
export type DemoPlanningSnapshot = { context: AgentContext; tasks: Task[]; runtimeDate: string; session?: DemoPlanningSession };
const text = z.string().min(1);
export const planningPreviewSchema = z.strictObject({
  previewId: text.nullable().optional(),
  planner: z.strictObject({ summary: text.max(120), strategy: z.array(z.strictObject({
    statement: text.max(120), reason: text.max(160), basedOnMemoryIds: z.array(text).max(3),
  })).max(1), targetAreas: z.array(z.enum(PLANNING_CATEGORIES)).max(3) }),
  candidates: z.strictObject({ candidateTaskIds: z.array(text), allowedTargetDates: z.record(text, z.array(isoDateSchema)),
    rejectedReasons: z.record(text, text) }),
  draft: z.strictObject({ actions: z.array(z.strictObject({ toolName: z.literal('update_task'),
    arguments: z.strictObject({ taskId: text, changes: z.strictObject({ plannedDate: isoDateSchema }) }), reason: text,
  })).max(3) }),
  policyChecks: z.array(z.strictObject({ name: z.enum(['DATE_ONLY', 'GENERAL_REPLAN']), result: z.literal('PASS') }))
    .length(2).refine((checks) => new Set(checks.map((check) => check.name)).size === 2),
});
export type PlanningPreview = z.infer<typeof planningPreviewSchema>;

export class PlanningPreviewError extends Error {
  constructor(message: string, readonly blocked: boolean, readonly code: string, readonly stage: string) { super(message); }
}
