import { z } from 'zod';

const categorySchema = z.enum([
  'ENGLISH', 'PROFESSIONAL', 'CAREER', 'PROJECT', 'FITNESS',
  'COURSE', 'LIFE', 'CUSTOM', 'INTERNSHIP', 'REVIEW', 'GENERAL',
]);

export const weeklyAnalysisResultSchema = z.object({
  summary: z.string().min(1),
  observations: z.array(z.object({
    title: z.string().min(1),
    evidence: z.string().min(1),
    category: categorySchema,
  })),
  risks: z.array(z.object({
    title: z.string().min(1),
    reason: z.string().min(1),
  })),
  suggestions: z.array(z.object({
    title: z.string().min(1),
    reason: z.string().min(1),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  })),
  data_gaps: z.array(z.string()),
});

export type WeeklyAnalysisResult = z.infer<typeof weeklyAnalysisResultSchema>;
