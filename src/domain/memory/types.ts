import { z } from 'zod';

const text = z.string().trim().min(1).max(4000);
export const memoryTypeSchema = z.enum(['PREFERENCE', 'PATTERN', 'STRATEGY', 'CONSTRAINT', 'LESSON']);
export const confidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const memoryCandidateSchema = z.object({
  type: memoryTypeSchema, content: text, evidence: text, confidence: confidenceSchema,
}).strict();
export const createMemorySchema = memoryCandidateSchema.extend({
  journeyId: z.string().min(1), sourceType: z.enum(['REFLECTION', 'USER']),
  sourceId: z.string().min(1).nullable().default(null),
}).strict().refine((value) => value.sourceType !== 'REFLECTION' || value.sourceId !== null,
  { message: '复盘记忆必须保留来源', path: ['sourceId'] });
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;
export type CreateMemoryInput = z.input<typeof createMemorySchema>;
export type Memory = z.output<typeof createMemorySchema> & {
  id: string; status: 'ACTIVE' | 'ARCHIVED'; createdAt: string; updatedAt: string;
};
export const memorySchema = memoryCandidateSchema.extend({
  id: z.string().min(1), journeyId: z.string().min(1), sourceType: z.enum(['REFLECTION', 'USER']),
  sourceId: z.string().min(1).nullable(), status: z.enum(['ACTIVE', 'ARCHIVED']),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict().refine((value) => value.sourceType !== 'REFLECTION' || value.sourceId !== null);

export function normalizeMemoryContent(content: string): string {
  return content.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function selectRelevantMemories(memories: Memory[], journeyId: string): Memory[] {
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return memories.filter((item) => item.journeyId === journeyId && item.status === 'ACTIVE')
    .sort((a, b) => rank[a.confidence] - rank[b.confidence]
      || b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt)
      || a.id.localeCompare(b.id)).slice(0, 20);
}
