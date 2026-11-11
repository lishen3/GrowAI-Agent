import { z } from 'zod';
import { confidenceSchema, memoryCandidateSchema } from '@/domain/memory/types';

const text = z.string().trim().min(1).max(4000);
export const evidenceReferenceSchema = z.object({
  source: z.enum(['LONG_TERM_GOAL', 'PERIOD_GOAL', 'WEEKLY_GOAL', 'TASK', 'EXECUTION', 'ACHIEVEMENT', 'STAT']),
  id: z.string().min(1).max(200), field: z.string().min(1).max(100),
  value: z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]),
}).strict();
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;
const references = z.array(evidenceReferenceSchema).min(1).max(20);
const factSchema = z.object({ statement: text, evidence: text, references: references.optional() }).strict();
export const growthAnalysisSchema = z.object({
  version: z.literal(1),
  goalAnalyses: z.array(z.object({
    goalId: z.string().min(1), progress: z.enum(['EVIDENCED', 'PARTIAL', 'RISK', 'INSUFFICIENT']),
    confidence: confidenceSchema, explanation: text,
    actions: z.array(z.object({
      taskId: z.string().min(1), relationship: z.enum(['DIRECT', 'INFERRED']),
      claim: z.enum(['PLANNED', 'COMPLETED']), explanation: text, references,
    }).strict()).max(30),
    references, gaps: z.array(text).max(10),
  }).strict()).max(30),
  nextWeekSuggestions: z.array(z.object({
    content: text, purpose: text, priority: z.enum(['S', 'A', 'B', 'C']),
    suggestedMinutes: z.number().int().positive().max(10080).nullable(), references,
  }).strict()).max(20),
  dataGaps: z.array(text).max(20),
}).strict();
export const weeklyReflectionDraftSchema = z.object({
  summary: text,
  facts: z.array(factSchema).max(30),
  insights: z.array(factSchema.extend({ confidence: confidenceSchema }).strict()).max(20),
  memoryCandidates: z.array(memoryCandidateSchema.extend({ references: references.optional() }).strict()).max(10),
  // Optional only for reading legacy records; new generation requires version 1.
  growth: growthAnalysisSchema.optional(),
}).strict();
export type WeeklyReflectionDraft = z.infer<typeof weeklyReflectionDraftSchema>;
const count = z.number().int().nonnegative();
const minutes = z.number().nonnegative().nullable();
export const reflectionTotalsSchema = z.object({ executionCount: count, actualMinutes: minutes, unknownMinutesCount: count,
  executionsTruncated: z.boolean(), achievementsTruncated: z.boolean() }).strict();
export const reviewSnapshotSchema = z.object({
  windowStart: z.iso.date(), windowEnd: z.iso.date(),
  facts: z.object({ plannedTaskCount: count, completedTaskCount: count, unfinishedTaskCount: count,
    cancelledTaskCount: count, plannedMinutes: minutes, actualMinutes: minutes, achievementCount: count,
    categoryBreakdown: z.array(z.object({ category: z.string(), categoryId: z.string().optional(),
      plannedTaskCount: count, completedTaskCount: count, plannedMinutes: minutes, actualMinutes: minutes }).strict()),
    windowStart: z.iso.date(), windowEnd: z.iso.date(),
  }).strict(),
  goals: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), targetDescription: z.string() }).strict()),
  categories: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
  evidence: z.array(z.object({ reference: evidenceReferenceSchema, label: z.string() }).strict()),
  scopeNote: z.string(),
  executionTotals: reflectionTotalsSchema.optional(),
}).strict();
export type ReviewSnapshot = z.infer<typeof reviewSnapshotSchema>;
export const reflectionSchema = weeklyReflectionDraftSchema.extend({
  id: z.string().min(1), journeyId: z.string().min(1), periodId: z.string().min(1),
  type: z.literal('WEEKLY'), startDate: z.iso.date(), endDate: z.iso.date(), createdAt: z.iso.datetime(),
  reviewSnapshot: reviewSnapshotSchema.optional(),
}).strict().refine((value) => value.startDate <= value.endDate);
export type Reflection = z.infer<typeof reflectionSchema>;
