import type { AgentContext } from '@/domain/agent/types';
import { timeMoveProposalSchema, timeScheduleProposalSchema, createAndScheduleProposalSchema, type CreateAndScheduleProposal, type TimeMoveProposal, type TimeScheduleProposal } from '@/domain/replan/timeAgent';
import { timeRuntimeDate } from '@/domain/replan/timeRuntime';
import { AI_CONNECTION_HELP, isNetworkFetchFailure } from './fetchFailure';

function checkDayPart(slot: { startTime: string; endTime: string }, message: string) {
  const part = /^(上午|早上|中午|下午|晚上)(?:（预计用时\d+分钟）)?[。！!]*$/.exec(message.trim());
  if (!part) return;
  const bounds: Record<string, [string, string]> = { 上午:['08:00','12:00'], 早上:['08:00','12:00'],
    中午:['12:00','14:00'], 下午:['12:00','18:00'], 晚上:['18:00','22:00'] };
  const [start, end] = bounds[part[1]];
  if (slot.startTime < start || slot.endTime > end) throw new Error(`生成时间不符合“${part[1]}”偏好，未执行排程，请重新描述时间`);
}

export interface TimeReplanGateway {
  proposeTimeMove(context: AgentContext, eventId: string, userMessage: string, durationMinutes?: number | null): Promise<TimeMoveProposal>;
  scheduleTask?(context: AgentContext, taskId: string, userMessage: string, durationMinutes?: number | null): Promise<TimeScheduleProposal>;
  createAndSchedule?(context: AgentContext, userMessage: string): Promise<CreateAndScheduleProposal>;
}

export class TimeReplanBackendClient implements TimeReplanGateway {
  constructor(private readonly baseUrl = process.env.EXPO_PUBLIC_GROWAI_API_URL ?? '',
    private readonly fetcher: typeof fetch = fetch) {}

  private async post(path: string, body: object) {
    if (!this.baseUrl) throw new Error('尚未配置 GrowAI Backend URL');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('排程等待超时，请检查连接后重新生成建议'));
        controller.abort();
      }, 135_000);
    });
    const send = async () => {
      const response = await this.fetcher.call(globalThis, this.baseUrl.replace(/\/$/, '') + '/api/v1/replan/time/' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ ...body, runtime_date: timeRuntimeDate(new Date()) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail?.message ?? `排程建议失败（${response.status}）`);
      return payload;
    };
    try { return await Promise.race([send(), timeout]); }
    catch (error) { if (isNetworkFetchFailure(error)) throw new Error(AI_CONNECTION_HELP); throw error; }
    finally { clearTimeout(timer); }
  }

  async createAndSchedule(context: AgentContext, userMessage: string) {
    const payload = await this.post('create-and-schedule', { context, user_message: userMessage });
    const proposal = createAndScheduleProposalSchema.parse(payload);
    checkDayPart(proposal, userMessage);
    return proposal;
  }

  async proposeTimeMove(context: AgentContext, eventId: string, userMessage: string, durationMinutes?: number | null) {
    const payload = await this.post('propose', { context, eventId, user_message: userMessage, duration_minutes: durationMinutes ?? undefined });
    const proposal = timeMoveProposalSchema.parse(payload);
    checkDayPart(proposal.after, userMessage);
    return proposal;
  }

  async scheduleTask(context: AgentContext, taskId: string, userMessage: string, durationMinutes?: number | null) {
    if (durationMinutes != null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 240)) throw new Error('排程时长必须为1至240的整数分钟');
    const payload = await this.post('schedule', { context, taskId, user_message: userMessage, duration_minutes: durationMinutes ?? undefined });
    const proposal = timeScheduleProposalSchema.parse(payload);
    checkDayPart(proposal.after, userMessage);
    return proposal;
  }
}
