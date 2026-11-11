import { z } from 'zod';
import type { PlanningCategory } from '@/domain/goals/planningTypes';

export const categoryNameSchema = z.string().trim().min(1, '请输入分类名称').max(80);
export const categoryIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/, '分类 ID 无效');
export const categorySchema = z.strictObject({
  id: categoryIdSchema, journeyId: z.string().min(1), name: categoryNameSchema,
  normalizedName: z.string().min(1), system: z.boolean(), status: z.enum(['ACTIVE', 'ARCHIVED']),
  sortOrder: z.number().int().nonnegative(), createdAt: z.iso.datetime().nullable(), updatedAt: z.iso.datetime().nullable(),
}).refine(row => row.normalizedName === row.name.normalize('NFKC').toLocaleLowerCase('zh-CN'), '分类名称规范化不一致');
export type ActionCategory = z.infer<typeof categorySchema>;
export const normalizeCategoryName = (name: string) => categoryNameSchema.parse(name).normalize('NFKC').toLocaleLowerCase('zh-CN');
// IDs match legacy values. Labels are not identifiers and do not imply a goal relationship.
export const LEGACY_CATEGORY_NAMES: Record<string, string> = {
  ENGLISH: '英语', PROFESSIONAL: '专业学习', CAREER: '职业发展', PROJECT: '项目实践',
  FITNESS: '健康运动', COURSE: '课程学业', LIFE: '生活社交', CUSTOM: '未分类',
  INTERNSHIP: '实习', REVIEW: '复盘总结',
};
/** Neutral compatibility bucket for custom IDs; never guess an English/project/etc. category. */
export function legacyCategoryForId(id: string): PlanningCategory {
  return Object.hasOwn(LEGACY_CATEGORY_NAMES,id) ? id as PlanningCategory : 'CUSTOM';
}
export function defaultCategories(journeyId: string): ActionCategory[] {
  return Object.entries({ ...LEGACY_CATEGORY_NAMES, STUDY_GROWTH: '学习成长' }).map(([id, name], sortOrder) => ({
    id, journeyId, name, normalizedName: normalizeCategoryName(name), system: true,
    status: 'ACTIVE', sortOrder, createdAt: null, updatedAt: null,
  }));
}
export interface CategoryRepository {
  subscribe?(listener: () => void): () => void;
  list(journeyId: string): Promise<ActionCategory[]>;
  create(journeyId: string, name: string): Promise<ActionCategory>;
  update(journeyId: string, id: string, changes: { name?: string; status?: ActionCategory['status'] }): Promise<ActionCategory>;
}
