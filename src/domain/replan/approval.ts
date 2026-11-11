import { z } from 'zod';
import { executionScopeSchema, approvedChangeSetSchema } from './execution';
import { isoDateSchema, taskSnapshotSchema } from '@/domain/tasks/dateOnly';

const text = z.string().min(1);
const timestamp = z.iso.datetime({ offset: true });
const status = z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'INVALID']);
const change = approvedChangeSetSchema.shape.changes.element;
export const approvalRequestSchema = z.strictObject({
  id: text, sourceType: z.literal('REPLAN_DATE_ONLY'), sourceDraftId: text, traceId: text.nullable(),
  createdAt: timestamp, expiresAt: timestamp, status, scope: executionScopeSchema,
  proposedChanges: z.array(change).length(1), selectedContentDigest: text,
  allowedDatesEvidence: z.strictObject({ dates: z.array(isoDateSchema), sourceType: z.literal('USER'), confirmationReference: text }),
  preconditions: z.strictObject({ expectedTaskFacts: taskSnapshotSchema, sourceContextDigest: text }),
  policyVersion: text, evaluatedAt: timestamp, decidedAt: timestamp.nullable(), invalidReason: z.string().nullable(),
});
export const approvalDecisionSchema = z.strictObject({
  status, request: approvalRequestSchema.nullable(), changeSet: approvedChangeSetSchema.nullable(), error: z.string().nullable(),
});
export type DemoApprovalRequest = z.infer<typeof approvalRequestSchema>;
