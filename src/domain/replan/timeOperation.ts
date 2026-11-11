import { z } from 'zod';
import { scheduleEventSchema } from '@/domain/scheduling/types';
import { taskSnapshotSchema, sameTask } from '@/domain/tasks/dateOnly';
import { timePeriodFactsSchema, timeSlotSchema } from './timeProposal';
import { sameContent } from './execution';

const id = z.string().min(1);
const timestamp = z.iso.datetime({ offset: true });
export const timeOperationScopeSchema = z.strictObject({
  databaseInstanceId: id, dataSpace: z.enum(['PERSONAL', 'DEMO']), epoch: z.string().regex(/^[1-9]\d*$/),
  journeyId: id, periodId: id, weekStart: timeSlotSchema.shape.date, weekEnd: timeSlotSchema.shape.date,
  sessionId: id.nullable(),
}).refine(scope => {
  const days = (Date.parse(`${scope.weekEnd}T00:00:00Z`) - Date.parse(`${scope.weekStart}T00:00:00Z`)) / 86400000;
  return days >= 0 && days <= 6 && (scope.dataSpace === 'DEMO' ? scope.sessionId !== null : scope.sessionId === null);
}, 'Invalid operation scope');
export const timeOperationStatusSchema = z.enum(['PENDING', 'COMMITTED', 'INVALID', 'EXPIRED', 'REJECTED', 'CANCELLED']);
export const declaredAvailabilitySchema = timeSlotSchema;
export type DeclaredAvailability = z.infer<typeof declaredAvailabilitySchema>;
export function assertDeclaredAvailability(target: unknown, window: unknown) {
  const slot = timeSlotSchema.parse(target), available = declaredAvailabilitySchema.parse(window);
  if (slot.date !== available.date || slot.startTime < available.startTime || slot.endTime > available.endTime) throw new Error('建议超出用户声明的可用窗口');
  return available;
}
export const replacementOperationId = (id: string) => `${id}:replacement`;
export const timeWriteOutcomeSchema = z.enum(['NOT_ATTEMPTED', 'ROLLED_BACK', 'UNKNOWN', 'COMMITTED']);
const receiptSchema = z.strictObject({ eventId: id, committedAt: timestamp });
const minutes = (slot: { startTime: string; endTime: string }) => {
  const n = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return n(slot.endTime) - n(slot.startTime);
};

/** Serializable durable-record contract only. No store, authorization issuer or write capability. */
export const timeOperationSchema = z.strictObject({
  operationId: id, providerProposalId: id, operationType: z.enum(['CREATE_TASK_TIME', 'MOVE_TASK_TIME', 'CREATE_AND_SCHEDULE']),
  scope: timeOperationScopeSchema, createdAt: timestamp, expiresAt: timestamp,
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/), status: timeOperationStatusSchema,
  eventId: id, expectedTaskFacts: taskSnapshotSchema, expectedPeriodFacts: timePeriodFactsSchema,
  expectedBefore: scheduleEventSchema.nullable(), after: timeSlotSchema,
  decidedAt: timestamp.nullable(), receipt: receiptSchema.nullable(),
  availability: declaredAvailabilitySchema.optional(),
  durationMinutes: z.number().int().min(1).max(240).optional(),
}).superRefine((op, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if(op.durationMinutes!==undefined && op.operationType!=='CREATE_TASK_TIME')invalid('Duration override only belongs to schedule-existing');
  if (op.availability && (op.after.date !== op.availability.date || op.after.startTime < op.availability.startTime || op.after.endTime > op.availability.endTime)) invalid('Target outside declared availability');
  if (Date.parse(op.createdAt) >= Date.parse(op.expiresAt)) invalid('Invalid lifetime');
  if (op.expectedTaskFacts.periodId !== op.scope.periodId) invalid('Task scope mismatch');
  const period = op.expectedPeriodFacts;
  if (period.id !== op.scope.periodId || period.journeyId !== op.scope.journeyId || period.status !== 'ACTIVE'
    || op.scope.weekStart < period.startDate || op.scope.weekEnd > period.endDate) invalid('Period scope mismatch');
  if (op.after.date < op.scope.weekStart || op.after.date > op.scope.weekEnd) invalid('Target outside window');
  if (op.after.startTime < '08:00' || op.after.endTime > '22:00') invalid('Target outside day window');
  if (op.status === 'PENDING' ? op.decidedAt !== null : op.decidedAt === null) invalid('Invalid decision time');
  if (op.decidedAt && Date.parse(op.decidedAt) < Date.parse(op.createdAt)) invalid('Decision predates creation');
  if ((op.status === 'COMMITTED') !== (op.receipt !== null)) invalid('Receipt must exist exactly for COMMITTED');
  if (op.receipt && (op.receipt.eventId !== op.eventId || op.receipt.committedAt !== op.decidedAt
    || Date.parse(op.receipt.committedAt) >= Date.parse(op.expiresAt))) invalid('Invalid commit receipt');
  if (op.operationType === 'CREATE_TASK_TIME' || op.operationType === 'CREATE_AND_SCHEDULE') {
    if (op.expectedBefore !== null || !(op.durationMinutes ?? op.expectedTaskFacts.estimatedMinutes)
      || minutes(op.after) !== (op.durationMinutes ?? op.expectedTaskFacts.estimatedMinutes)) invalid('Invalid create facts');
    const planned = op.expectedTaskFacts.plannedDate;
    if (op.operationType === 'CREATE_AND_SCHEDULE' && planned !== null
      && (planned < op.scope.weekStart || planned > op.scope.weekEnd)) invalid('Task outside create window');
    if (op.operationType === 'CREATE_AND_SCHEDULE') {
      // For this action only, expectedTaskFacts is the immutable *planned new record*, not an existing Task.
      const task = op.expectedTaskFacts;
      if (task.status !== 'TODO' || task.plannedDate !== op.after.date || task.category !== 'CUSTOM'
        || task.categoryId !== undefined || task.priority !== 'B' || task.periodGoalId !== null || task.weeklyGoalId !== null
        || task.description !== null || task.deadline !== null || task.startedAt !== null || task.completedAt !== null
        || task.createdAt !== op.createdAt || task.title.trim().length === 0 || task.title.length > 200
        || minutes(op.after) < 30 || minutes(op.after) > 240 || Number(op.after.startTime.slice(3)) % 30
        || Number(op.after.endTime.slice(3)) % 30) invalid('Invalid new task facts');
    }
  } else {
    const before = op.expectedBefore;
    if (!before || before.id !== op.eventId || before.taskId !== op.expectedTaskFacts.id
      || before.periodId !== op.scope.periodId || before.type !== 'TASK' || before.source !== 'USER'
      || before.date < op.scope.weekStart || before.date > op.scope.weekEnd
      || sameContent({ date: before.date, startTime: before.startTime, endTime: before.endTime }, op.after)) invalid('Invalid move facts');
  }
});
export type TimeOperation = z.infer<typeof timeOperationSchema>;
export type TimeOperationScope = z.infer<typeof timeOperationScopeSchema>;
/** A local persisted-operation reference, never part of model output. */
export const timeOperationReferenceSchema = z.strictObject({
  operationId: id, contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type TimeOperationReference = z.infer<typeof timeOperationReferenceSchema>;

/** Must be called with transaction-read facts in a future atomic adapter. Does not check conflicts/READY/clock. */
export function validateTimeTarget(input: unknown, taskInput: unknown, eventInput: unknown): void {
  const op = timeOperationSchema.parse(input);
  const task = taskSnapshotSchema.parse(taskInput);
  if (!sameTask(task, op.expectedTaskFacts) || !['TODO', 'DELAYED'].includes(task.status)) throw new Error('TASK_FACTS_CHANGED_OR_NOT_MOVABLE');
  if (op.operationType === 'MOVE_TASK_TIME' && !sameContent(scheduleEventSchema.parse(eventInput), op.expectedBefore)) {
    throw new Error('EVENT_FACTS_CHANGED');
  }
}

const confirmationSchema = z.strictObject({ operationId: id, confirmedContentDigest: z.string().regex(/^[a-f0-9]{64}$/) });
export type TimeConfirmationDecision =
  | { kind: 'REJECTED'; reason: string }
  | { kind: 'RECEIPT'; receipt: z.infer<typeof receiptSchema> }
  | { kind: 'READY_FOR_ATOMIC_EXECUTION' };

/** Pure precheck, never grants write permission. Missing records cannot be minted from Provider output. */
export function checkTimeConfirmation(record: unknown, confirmation: unknown, currentScope: unknown,
  now: string, platform: 'WEB' | 'NATIVE'): TimeConfirmationDecision {
  const op = timeOperationSchema.safeParse(record);
  const confirmed = confirmationSchema.safeParse(confirmation);
  const scope = timeOperationScopeSchema.safeParse(currentScope);
  if (!op.success || !confirmed.success || !scope.success || !timestamp.safeParse(now).success) return { kind: 'REJECTED', reason: 'INVALID_OR_MISSING_RECORD' };
  const value = op.data;
  if (value.operationId !== confirmed.data.operationId || value.contentDigest !== confirmed.data.confirmedContentDigest
    || !sameContent(value.scope, scope.data)) return { kind: 'REJECTED', reason: 'CONFIRMATION_OR_SCOPE_MISMATCH' };
  if (value.status === 'COMMITTED') return { kind: 'RECEIPT', receipt: value.receipt! };
  if (platform !== 'WEB') return { kind: 'REJECTED', reason: 'NATIVE_ATOMIC_WRITES_NOT_VERIFIED' };
  if (value.status !== 'PENDING' || Date.parse(now) < Date.parse(value.createdAt)
    || Date.parse(now) >= Date.parse(value.expiresAt)) return { kind: 'REJECTED', reason: 'NOT_PENDING_OR_EXPIRED' };
  return { kind: 'READY_FOR_ATOMIC_EXECUTION' };
}

/** Transition assertion only; caller must persist atomically with the actual event write. */
export function assertTimeTransition(beforeInput: unknown, afterInput: unknown): void {
  const before = timeOperationSchema.parse(beforeInput);
  const after = timeOperationSchema.parse(afterInput);
  if (before.status !== 'PENDING') {
    if (!sameContent(before, after)) throw new Error('TERMINAL_OPERATION_IS_IMMUTABLE');
    return;
  }
  const frozen = ({ status: _status, decidedAt: _decidedAt, receipt: _receipt, ...content }: TimeOperation) => content;
  if (!sameContent(frozen(before), frozen(after))) throw new Error('OPERATION_CONTENT_IS_IMMUTABLE');
}

export const timeWriteResultSchema = z.strictObject({
  operationId: id, eventId: id.nullable(), status: z.enum(['SUCCESS', 'REJECTED', 'FAILED', 'NEEDS_RECONCILIATION']),
  writeOutcome: timeWriteOutcomeSchema, readbackVerified: z.boolean(),
}).refine(result => (result.status !== 'SUCCESS' || result.writeOutcome === 'COMMITTED' && result.readbackVerified && result.eventId !== null)
  && (!result.readbackVerified || result.writeOutcome === 'COMMITTED')
  && (result.status !== 'REJECTED' || result.writeOutcome === 'NOT_ATTEMPTED')
  && (result.writeOutcome !== 'UNKNOWN' || result.status === 'NEEDS_RECONCILIATION'), 'Inconsistent write knowledge');

/** Future implementors must retain terminal records; this interface provides NO persistence implementation. */
export interface TimeOperationReader {
  getOperation(operationId: string): Promise<TimeOperation | null>;
}
