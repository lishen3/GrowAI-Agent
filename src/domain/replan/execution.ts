import { z } from 'zod';
import { isoDateSchema, taskSnapshotSchema } from '@/domain/tasks/dateOnly';
import type { Task } from '@/domain/tasks/types';

const text = z.string().min(1);
const timestamp = z.iso.datetime({ offset: true });
const policyCheck = z.strictObject({ name: z.enum(['DATE_ONLY', 'GENERAL_REPLAN']), result: z.enum(['PASS', 'FAIL']) });
const checks = z.array(policyCheck).length(2).refine((items) =>
  new Set(items.map((item) => item.name)).size === 2 && items.every((item) => item.result === 'PASS'));
export const executionScopeSchema = z.strictObject({
  journeyId: text, periodId: text, weekStart: isoDateSchema, weekEnd: isoDateSchema,
  dataSpace: z.enum(['PERSONAL', 'DEMO']), sessionId: text, resetEpoch: z.number().int().nonnegative(),
});
const dateChange = z.strictObject({ plannedDate: isoDateSchema });
// Validation of the existing Python contract at the local execution boundary.
export const approvedChangeSetSchema = z.strictObject({
  id: text, approvalRequestId: text, scope: executionScopeSchema,
  approvedAt: timestamp, executeBefore: timestamp, approvalContentDigest: text,
  changes: z.array(z.strictObject({
    id: text, taskId: text, toolName: z.literal('update_task'), before: dateChange, after: dateChange,
    reason: text, policyChecks: checks,
  })).length(1),
  expectedTaskFacts: taskSnapshotSchema,
  policyValidation: z.strictObject({ version: text, evaluatedAt: timestamp, checks }),
  authorizationReference: text,
});
export type ApprovedChangeSet = z.infer<typeof approvedChangeSetSchema>;
export type ExecutionScope = z.infer<typeof executionScopeSchema>;
export type ExecutionResult = {
  executionId: string;
  changeSetId: string | null;
  taskId: string | null;
  status: 'SUCCESS' | 'REJECTED' | 'FAILED';
  before: Task | null;
  after: Task | null;
  reason: string;
  writeOutcome: 'NOT_ATTEMPTED' | 'COMMITTED' | 'UNKNOWN';
};

export function sameContent(left: unknown, right: unknown): boolean {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
    );
    return value;
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
