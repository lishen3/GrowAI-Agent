import { z } from 'zod';
import { detectScheduleConflicts } from '@/domain/scheduling/detectScheduleConflicts';
import { scheduleEventSchema, type ScheduleEvent } from '@/domain/scheduling/types';
import { sameContent } from './execution';
import {
  timeApprovedChangeSetSchema,
  timePeriodFactsSchema,
  timeProposalSchema,
  timeReplanScopeSchema,
  timeWeekEventFactSchema,
  type TimeProposal,
  type TimeWeekEventFact,
} from './timeProposal';

const timestamp = z.iso.datetime({ offset: true });
export const timePolicyFailureSchema = z.enum([
  'INVALID_PROPOSAL', 'INVALID_FACTS', 'PROPOSAL_NOT_YET_VALID', 'PROPOSAL_EXPIRED',
  'APPROVAL_MISMATCH', 'APPROVAL_EXPIRED', 'SCOPE_CHANGED', 'EVENT_NOT_FOUND',
  'EVENT_NOT_MOVABLE', 'EVENT_FACTS_CHANGED', 'TASK_NOT_FOUND', 'TASK_NOT_MOVABLE',
  'TASK_FACTS_CHANGED', 'PERIOD_NOT_FOUND', 'PERIOD_NOT_ACTIVE', 'PERIOD_FACTS_CHANGED',
  'WEEK_FACTS_CHANGED', 'INVALID_SLOT', 'NO_OP', 'DURATION_CHANGED', 'OUT_OF_SCOPE',
  'TARGET_DATE_IS_PAST', 'CONFLICT',
]);
export const timePolicyDecisionSchema = z.discriminatedUnion('allowed', [
  z.strictObject({ allowed: z.literal(true), reason: z.literal('ALLOWED') }),
  z.strictObject({ allowed: z.literal(false), reason: timePolicyFailureSchema }),
]);
export type TimePolicyDecision = z.infer<typeof timePolicyDecisionSchema>;

export const timeFreshValidationSchema = z.strictObject({
  status: z.enum(['VALID', 'INVALID']),
  checkedAt: timestamp,
  proposalId: z.string().min(1).nullable(),
  approvalRequestId: z.string().min(1).nullable(),
  decision: timePolicyDecisionSchema,
}).refine((result) => (result.status === 'VALID') === result.decision.allowed, {
  message: 'Fresh Validation status must match its Policy decision', path: ['status'],
});
export type TimeFreshValidation = z.infer<typeof timeFreshValidationSchema>;

const currentFactsSchema = z.strictObject({
  scope: timeReplanScopeSchema,
  event: scheduleEventSchema.nullable(),
  task: timeProposalSchema.shape.expectedTaskFacts.nullable(),
  period: timePeriodFactsSchema.nullable(),
  weekEvents: z.array(timeWeekEventFactSchema),
});

function denied(reason: z.infer<typeof timePolicyFailureSchema>): TimePolicyDecision {
  return { allowed: false, reason };
}

function slotOf(event: ScheduleEvent) {
  return { date: event.date, startTime: event.startTime, endTime: event.endTime };
}

function slotMinutes(slot: { startTime: string; endTime: string }): number {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return minutes(slot.endTime) - minutes(slot.startTime);
}

function chinaDate(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function sortedWeekEvents(events: TimeWeekEventFact[]): TimeWeekEventFact[] {
  return events.map((event) => ({ ...event })).sort((a, b) => a.id.localeCompare(b.id));
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function proposalFactsFailure(proposal: TimeProposal): z.infer<typeof timePolicyFailureSchema> | null {
  const { expectedEventFacts: event, expectedTaskFacts: task, expectedPeriodFacts: period } = proposal;
  const lower = proposal.scope.weekStart > period.startDate ? proposal.scope.weekStart : period.startDate;
  const upper = proposal.scope.weekEnd < period.endDate ? proposal.scope.weekEnd : period.endDate;
  const matchingEvents = proposal.expectedWeekEvents.filter((item) => item.id === proposal.scheduleEventId);
  const ids = proposal.expectedWeekEvents.map((item) => item.id);
  const identitiesMatch = proposal.scope.periodId === proposal.periodId
    && proposal.scope.journeyId === period.journeyId
    && event.type === 'TASK' && event.source === 'USER'
    && event.id === proposal.scheduleEventId && event.periodId === proposal.periodId && event.taskId === proposal.taskId
    && task.id === proposal.taskId && task.periodId === proposal.periodId
    && period.id === proposal.periodId
    && sameContent(slotOf(event), proposal.before)
    && sameContent(matchingEvents[0], event)
    && matchingEvents.length === 1
    && new Set(ids).size === ids.length;
  if (!identitiesMatch) return 'INVALID_PROPOSAL';
  if (!proposal.expectedWeekEvents.every((item) => item.periodId === proposal.periodId
    && inRange(item.date, lower, upper))) return 'INVALID_FACTS';
  if (!inRange(proposal.before.date, lower, upper) || !inRange(proposal.after.date, lower, upper)) return 'OUT_OF_SCOPE';
  return null;
}

function baseProposalDecision(proposal: TimeProposal, now: string): TimePolicyDecision | null {
  const nowMs = Date.parse(now);
  if (Date.parse(proposal.createdAt) > nowMs) return denied('PROPOSAL_NOT_YET_VALID');
  if (nowMs >= Date.parse(proposal.expiresAt)) return denied('PROPOSAL_EXPIRED');
  if (proposal.expectedPeriodFacts.status !== 'ACTIVE') return denied('PERIOD_NOT_ACTIVE');
  if (proposal.expectedTaskFacts.status !== 'TODO' && proposal.expectedTaskFacts.status !== 'DELAYED') {
    return denied('TASK_NOT_MOVABLE');
  }
  if (proposal.after.date < chinaDate(now)) return denied('TARGET_DATE_IS_PAST');
  const factsFailure = proposalFactsFailure(proposal);
  if (factsFailure) return denied(factsFailure);
  if (sameContent(proposal.before, proposal.after)) return denied('NO_OP');
  if (slotMinutes(proposal.before) !== slotMinutes(proposal.after)) return denied('DURATION_CHANGED');
  return null;
}

/** Pure current-facts check. The caller is responsible for supplying a complete, fresh read model. */
export function validateTimeProposalFresh(
  proposalInput: unknown,
  approvalInput: unknown,
  factsInput: unknown,
  now: string,
): TimeFreshValidation {
  const checkedAt = timestamp.parse(now);
  const proposalParsed = timeProposalSchema.safeParse(proposalInput);
  const proposal = proposalParsed.success ? proposalParsed.data : null;
  const approvalParsed = timeApprovedChangeSetSchema.safeParse(approvalInput);
  const approval = approvalParsed.success ? approvalParsed.data : null;
  const factsParsed = currentFactsSchema.safeParse(factsInput);
  let decision: TimePolicyDecision;

  if (!proposal) {
    const invalidSlot = !proposalParsed.success && proposalParsed.error.issues.some((issue) =>
      issue.path[0] === 'before' || issue.path[0] === 'after');
    decision = denied(invalidSlot ? 'INVALID_SLOT' : 'INVALID_PROPOSAL');
  }
  else if (!approval || !sameContent(approval.approvedProposal, proposal)) decision = denied('APPROVAL_MISMATCH');
  else if (!factsParsed.success) decision = denied('INVALID_FACTS');
  else {
    const baseFailure = baseProposalDecision(proposal, checkedAt);
    if (baseFailure) decision = baseFailure;
    else if (Date.parse(approval.approvedAt) > Date.parse(checkedAt)
      || Date.parse(checkedAt) >= Date.parse(approval.executeBefore)) decision = denied('APPROVAL_EXPIRED');
    else {
      const facts = factsParsed.data;
      const current = facts.event;
      const task = facts.task;
      const period = facts.period;
      if (!sameContent(facts.scope, proposal.scope)) decision = denied('SCOPE_CHANGED');
      else if (!current) decision = denied('EVENT_NOT_FOUND');
      else if (current.type !== 'TASK' || current.source !== 'USER' || current.taskId === null) decision = denied('EVENT_NOT_MOVABLE');
      else if (current.id !== proposal.scheduleEventId || current.periodId !== proposal.periodId
        || current.taskId !== proposal.taskId || !sameContent(current, proposal.expectedEventFacts)) {
        decision = denied('EVENT_FACTS_CHANGED');
      } else if (!task) decision = denied('TASK_NOT_FOUND');
      else if (task.id !== proposal.taskId || task.periodId !== proposal.periodId) decision = denied('TASK_FACTS_CHANGED');
      else if (task.status !== 'TODO' && task.status !== 'DELAYED') decision = denied('TASK_NOT_MOVABLE');
      else if (!sameContent(task, proposal.expectedTaskFacts)) decision = denied('TASK_FACTS_CHANGED');
      else if (!period) decision = denied('PERIOD_NOT_FOUND');
      else if (period.status !== 'ACTIVE') decision = denied('PERIOD_NOT_ACTIVE');
      else if (period.id !== proposal.periodId || period.journeyId !== proposal.scope.journeyId
        || !sameContent(period, proposal.expectedPeriodFacts)) decision = denied('PERIOD_FACTS_CHANGED');
      else if (!sameContent(sortedWeekEvents(facts.weekEvents), sortedWeekEvents(proposal.expectedWeekEvents))) {
        decision = denied('WEEK_FACTS_CHANGED');
      } else if (facts.weekEvents.filter((item) => item.id === proposal.scheduleEventId).length !== 1) {
        decision = denied('INVALID_FACTS');
      } else {
        const beforeEvents = facts.weekEvents.map(({ courseId: _courseId, ...event }) => event);
        const afterEvents = beforeEvents.map((event) => event.id === proposal.scheduleEventId
          ? { ...event, ...proposal.after }
          : event);
        const beforeConflicts = detectScheduleConflicts(beforeEvents);
        const afterConflicts = detectScheduleConflicts(afterEvents);
        const targetHasConflict = afterConflicts.some((conflict) =>
          conflict.eventAId === proposal.scheduleEventId || conflict.eventBId === proposal.scheduleEventId);
        const conflictKey = (eventAId: string, eventBId: string) => [eventAId, eventBId].sort().join('\u0000');
        const priorOtherConflicts = new Set(beforeConflicts
          .filter((conflict) => conflict.eventAId !== proposal.scheduleEventId && conflict.eventBId !== proposal.scheduleEventId)
          .map((conflict) => conflictKey(conflict.eventAId, conflict.eventBId)));
        const newOtherConflict = afterConflicts.some((conflict) =>
          conflict.eventAId !== proposal.scheduleEventId && conflict.eventBId !== proposal.scheduleEventId
          && !priorOtherConflicts.has(conflictKey(conflict.eventAId, conflict.eventBId)));
        decision = targetHasConflict || newOtherConflict ? denied('CONFLICT') : { allowed: true, reason: 'ALLOWED' };
      }
    }
  }

  return timeFreshValidationSchema.parse({
    status: decision.allowed ? 'VALID' : 'INVALID', checkedAt,
    proposalId: proposal?.proposalId ?? null,
    approvalRequestId: approval?.approvalRequestId ?? null,
    decision,
  });
}
