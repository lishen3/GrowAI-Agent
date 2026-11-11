import { z } from 'zod';
import { PLANNING_CATEGORIES } from '@/domain/goals/planningTypes';
import { isIsoDate } from '@/shared/date';

const title = z.string().trim().min(1);
const plannedDate = z.string().refine(isIsoDate, '计划日期格式应为 YYYY-MM-DD');
export const createTaskArgumentsSchema = z.strictObject({
  title, category: z.enum(PLANNING_CATEGORIES), categoryId: z.string().min(1).optional(),
  description: z.string().optional(), plannedDate: plannedDate.optional(),
  estimatedMinutes: z.number().int().nonnegative().optional(), weeklyGoalId: title.optional(),
});
export const taskChangesSchema = z.strictObject({
  categoryId: z.string().min(1).optional(), title: title.optional(), description: z.string().optional(),
  plannedDate: plannedDate.optional(), estimatedMinutes: z.number().int().nonnegative().optional(),
}).refine((changes) => Object.values(changes).some((value) => value !== undefined), '修改字段不能为空');
export const updateTaskArgumentsSchema = z.strictObject({ taskId: title, changes: taskChangesSchema });
const common = { id: title, reason: title, requiresConfirmation: z.literal(true) };
export const agentActionSchema = z.discriminatedUnion('toolName', [
  z.strictObject({ ...common, toolName: z.literal('create_task'), arguments: createTaskArgumentsSchema }),
  z.strictObject({ ...common, toolName: z.literal('update_task'), arguments: updateTaskArgumentsSchema }),
]);
export const agentActionProposalSchema = z.strictObject({
  message: title, actions: z.array(agentActionSchema).max(10),
});
export const authorizationSchema = z.strictObject({
  actionId: title, status: z.enum(['APPROVED', 'REJECTED']), periodId: title,
  action: agentActionSchema,
});
export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentActionProposal = z.infer<typeof agentActionProposalSchema>;
export type ActionAuthorization = z.infer<typeof authorizationSchema>;
export type ActionStatus = 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'FAILED';
