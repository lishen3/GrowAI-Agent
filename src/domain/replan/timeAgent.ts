import { z } from 'zod';
import { timeSlotSchema } from './timeProposal';

const timestamp = z.iso.datetime({ offset: true });
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** Backend proposal for moving one existing TASK event. It is never an execution proof. */
export const timeMoveProposalSchema = z.strictObject({
  proposalId: z.string().min(1),
  eventId: z.string().min(1),
  taskId: z.string().min(1),
  before: timeSlotSchema,
  after: timeSlotSchema,
  reason: z.string().trim().min(1).max(4000),
  candidates: z.array(timeSlotSchema).max(200),
  createdAt: timestamp,
  expiresAt: timestamp,
}).refine((proposal) => proposal.before.date !== proposal.after.date
  || proposal.before.startTime !== proposal.after.startTime
  || proposal.before.endTime !== proposal.after.endTime, '目标时间块不能与原时间块相同')
  .refine((proposal) => Date.parse(proposal.createdAt) < Date.parse(proposal.expiresAt), '提案过期时间无效');

export type TimeMoveProposal = z.infer<typeof timeMoveProposalSchema>;

export const timeScheduleProposalSchema = z.strictObject({
  proposalId: z.string().min(1),
  taskId: z.string().min(1),
  after: timeSlotSchema,
  reason: z.string().trim().min(1).max(4000),
  candidates: z.array(timeSlotSchema).max(200),
  createdAt: timestamp,
  expiresAt: timestamp,
}).refine((proposal) => Date.parse(proposal.createdAt) < Date.parse(proposal.expiresAt), '提案过期时间无效');

export type TimeScheduleProposal = z.infer<typeof timeScheduleProposalSchema>;

/** Model describes a new task, but cannot select IDs, categories or grant authority. */
export const createAndScheduleProposalSchema = z.strictObject({
  action: z.literal('CREATE_AND_SCHEDULE'), taskTitle: z.string().trim().min(1).max(200),
  date: timeSlotSchema.shape.date, startTime: timeSlotSchema.shape.startTime, endTime: timeSlotSchema.shape.endTime,
  reason: z.string().trim().min(1).max(4000), proposalId: z.string().min(1), createdAt: timestamp, expiresAt: timestamp,
}).refine(p => p.startTime < p.endTime && p.startTime >= '08:00' && p.endTime <= '22:00'
  && minutes(p.startTime) % 30 === 0 && minutes(p.endTime) % 30 === 0
  && minutes(p.endTime) - minutes(p.startTime) >= 30 && minutes(p.endTime) - minutes(p.startTime) <= 240
  && Date.parse(p.createdAt) < Date.parse(p.expiresAt), '新建排程时间无效');
export type CreateAndScheduleProposal = z.infer<typeof createAndScheduleProposalSchema>;
