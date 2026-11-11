import { z } from 'zod';
import { agentActionSchema } from '@/domain/agent/actions';

const text = z.string().trim().min(1).max(4000);
export const replanImpactSchema = z.strictObject({
  beforePlannedMinutes: z.number().int().nonnegative().nullable(),
  afterPlannedMinutes: z.number().int().nonnegative().nullable(),
  affectedTaskCount: z.number().int().nonnegative(),
});
export const weeklyReplanProposalSchema = z.strictObject({
  summary: text,
  diagnosis: z.array(z.strictObject({ statement: text, evidence: text })).max(20),
  strategy: z.array(z.strictObject({ statement: text, reason: text, basedOnMemoryIds: z.array(text).max(20) })).max(20),
  expectedChanges: replanImpactSchema,
  actions: z.array(agentActionSchema).max(10),
});
export type WeeklyReplanProposal = z.infer<typeof weeklyReplanProposalSchema>;
