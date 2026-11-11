import { z } from 'zod';
import { timeMoveProposalSchema, timeScheduleProposalSchema, createAndScheduleProposalSchema } from '@/domain/replan/timeAgent';
import { reflectionSchema } from '@/domain/reflection/types';
import { timeOperationReferenceSchema } from '@/domain/replan/timeOperation';
export const conversationScopeSchema = z.strictObject({ journeyId: z.string().min(1), periodId: z.string().min(1) });
export type ConversationScope = z.infer<typeof conversationScopeSchema>;
export const conversationMessageSchema = z.strictObject({
  id: z.string().min(1), role: z.enum(['user', 'agent']), text: z.string().max(16000),
  status: z.enum(['info', 'pending', 'complete', 'failed', 'cancelled', 'interrupted']).default('info'),
  proposal: z.union([timeMoveProposalSchema, timeScheduleProposalSchema, createAndScheduleProposalSchema]).optional(),
  timeOperation: timeOperationReferenceSchema.optional(),
  reflection: reflectionSchema.optional(), analysis: z.boolean().optional(),
  requestId: z.string().optional(),
  schedulingDraft: z.strictObject({ action: z.enum(['schedule', 'move']), input: z.string().max(2000),
    estimate: z.string().max(3), selected: z.string().nullable(), fromCalendar: z.boolean() }).optional(),
  reflectionRecovery: z.enum(['unknown', 'not_started', 'failed', 'unavailable']).optional(),
  reflectionInput: z.strictObject({ date: z.iso.date(), epoch: z.string().min(1) }).optional(),
  decision: z.strictObject({ reflectionId: z.string(), index: z.number().int().nonnegative(), value: z.string() }).optional(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export const conversationSchema = z.strictObject({
  id: z.string().min(1), scope: conversationScopeSchema, epoch: z.string().min(1),
  createdAt: z.string(), updatedAt: z.string(), messages: z.array(conversationMessageSchema).max(2000),
});
export type Conversation = z.infer<typeof conversationSchema>;
// Snapshot messages are evidence/display only, never an execution authorization.
export interface ConversationRepository {
  readonly savesReflectionOnAppend?: true;
  list(scope: ConversationScope): Promise<Conversation[]>;
  create(scope: ConversationScope): Promise<Conversation>;
  append(scope: ConversationScope, id: string, message: ConversationMessage): Promise<Conversation>;
  clear(scope: ConversationScope): Promise<void>;
}
