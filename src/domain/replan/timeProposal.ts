import { z } from 'zod';
import { scheduleEventSchema, type ScheduleEvent } from '@/domain/scheduling/types';
import { isoDateSchema, taskSnapshotSchema } from '@/domain/tasks/dateOnly';

const text = z.string().trim().min(1);
const timestamp = z.iso.datetime({ offset: true });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const timeSlotSchema = z.strictObject({
  date: isoDateSchema,
  startTime: time,
  endTime: time,
}).refine((slot) => slot.startTime < slot.endTime, '结束时间必须晚于开始时间，不支持跨日');
export type TimeSlot = z.infer<typeof timeSlotSchema>;

export const timeReplanScopeSchema = z.strictObject({
  journeyId: text,
  periodId: text,
  weekStart: isoDateSchema,
  weekEnd: isoDateSchema,
  dataSpace: z.enum(['PERSONAL', 'DEMO']),
  sessionId: text.nullable(),
  resetEpoch: z.number().int().nonnegative().nullable(),
}).refine((scope) => {
  const days = (Date.parse(`${scope.weekEnd}T00:00:00Z`) - Date.parse(`${scope.weekStart}T00:00:00Z`)) / 86400000;
  return days >= 0 && days <= 6
    && (scope.dataSpace === 'PERSONAL'
      ? scope.sessionId === null && scope.resetEpoch === null
      : scope.sessionId !== null && scope.resetEpoch !== null);
}, '排程范围必须是有效的单周范围及匹配的数据空间');
export type TimeReplanScope = z.infer<typeof timeReplanScopeSchema>;

export const timePeriodFactsSchema = z.strictObject({
  id: text,
  journeyId: text,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED']),
  weekStartsOn: z.union([z.literal(1), z.literal(7)]),
  currentWeekOverride: z.number().int().nullable(),
}).refine((period) => period.startDate <= period.endDate, '阶段日期范围无效');
export type TimePeriodFacts = z.infer<typeof timePeriodFactsSchema>;

/** Accepts canonical stored events and the Course projection's extra courseId field. */
export type TimeWeekEventFact = ScheduleEvent & { courseId?: string };
function isTimeWeekEventFact(value: unknown): value is TimeWeekEventFact {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const { courseId, ...event } = record;
  const parsed = scheduleEventSchema.safeParse(event);
  return parsed.success && (courseId === undefined
    || parsed.data.type === 'COURSE' && typeof courseId === 'string' && courseId.length > 0);
}
export const timeWeekEventFactSchema = z.custom<TimeWeekEventFact>(isTimeWeekEventFact, {
  message: '周排程事实格式无效',
});

export const timeProposalSchema = z.strictObject({
  discriminator: z.literal('REPLAN_SCHEDULE_TIME'),
  operation: z.literal('MOVE_SCHEDULE_EVENT'),
  proposalId: text,
  createdAt: timestamp,
  expiresAt: timestamp,
  scope: timeReplanScopeSchema,
  periodId: text,
  scheduleEventId: text,
  taskId: text,
  before: timeSlotSchema,
  after: timeSlotSchema,
  expectedEventFacts: scheduleEventSchema,
  expectedTaskFacts: taskSnapshotSchema,
  expectedPeriodFacts: timePeriodFactsSchema,
  expectedWeekEvents: z.array(timeWeekEventFactSchema),
  policyVersion: text,
}).refine((proposal) => Date.parse(proposal.createdAt) < Date.parse(proposal.expiresAt), {
  message: 'Proposal expiry must follow creation', path: ['expiresAt'],
});
export type TimeProposal = z.infer<typeof timeProposalSchema>;

/** The approved object embeds the exact Proposal; it is not itself proof of user identity. */
export const timeApprovedChangeSetSchema = z.strictObject({
  discriminator: z.literal('REPLAN_SCHEDULE_TIME'),
  approvalRequestId: text,
  approvedAt: timestamp,
  executeBefore: timestamp,
  approvedProposal: timeProposalSchema,
}).refine((approval) => Date.parse(approval.approvedAt) < Date.parse(approval.executeBefore)
  && Date.parse(approval.executeBefore) <= Date.parse(approval.approvedProposal.expiresAt)
  && Date.parse(approval.approvedAt) >= Date.parse(approval.approvedProposal.createdAt), {
  message: 'Approval validity must be contained within its Proposal lifetime', path: ['executeBefore'],
});
export type TimeApprovedChangeSet = z.infer<typeof timeApprovedChangeSetSchema>;

export const timeExecutionResultSchema = z.strictObject({
  executionId: text,
  changeSetId: text.nullable(),
  proposalId: text.nullable(),
  scheduleEventId: text.nullable(),
  taskId: text.nullable(),
  status: z.enum(['SUCCESS', 'REJECTED', 'CONFLICT', 'CONDITION_MISMATCH', 'FAILED', 'UNKNOWN']),
  writeOutcome: z.enum(['NOT_ATTEMPTED', 'COMMITTED', 'UNKNOWN']),
  readbackVerified: z.boolean(),
  failureCode: text.nullable(),
}).refine((result) => result.status !== 'SUCCESS'
  || result.writeOutcome === 'COMMITTED' && result.readbackVerified, {
  message: 'SUCCESS requires a committed write and verified readback', path: ['readbackVerified'],
}).refine((result) => !['REJECTED', 'CONFLICT', 'CONDITION_MISMATCH'].includes(result.status)
  || result.writeOutcome === 'NOT_ATTEMPTED' && !result.readbackVerified, {
  message: 'Pre-write rejection statuses cannot claim a write or readback', path: ['writeOutcome'],
}).refine((result) => result.status !== 'UNKNOWN'
  || result.writeOutcome === 'UNKNOWN' && !result.readbackVerified, {
  message: 'UNKNOWN requires an uncertain write outcome without verified readback', path: ['writeOutcome'],
});
export type TimeExecutionResult = z.infer<typeof timeExecutionResultSchema>;
