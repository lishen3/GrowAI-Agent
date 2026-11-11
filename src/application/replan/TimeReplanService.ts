import { createId } from '@/shared/id';
import { assertDeclaredAvailability, declaredAvailabilitySchema, type DeclaredAvailability } from '@/domain/replan/timeOperation';
import { timeRuntimeDate, isTimeBlockAdjustable, assertFutureTimeSlot } from '@/domain/replan/timeRuntime';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { AgentContextService } from '@/application/agent/AgentContextService';
import type { AgentContext } from '@/domain/agent/types';
import type { Period } from '@/domain/periods/types';
import { timeMoveProposalSchema, timeScheduleProposalSchema, createAndScheduleProposalSchema, type CreateAndScheduleProposal, type TimeMoveProposal, type TimeScheduleProposal } from '@/domain/replan/timeAgent';
import { calculatePeriodWeek, getPeriodWeekRange, isIsoDate, todayIso } from '@/shared/date';
import { timeSlotSchema, timePeriodFactsSchema } from '@/domain/replan/timeProposal';
import { taskSnapshotSchema } from '@/domain/tasks/dateOnly';
import { timeOperationReferenceSchema, type AtomicTimeResult, type TimeOperationAdapter, type TimeOperationPreparation } from './TimeOperationAdapter';
import { addDays, parseISO } from 'date-fns';

export type SchedulingWindow = { startDate: string; endDate: string };

export function requestedSchedulingWindow(period: Period, message: string, fallback: SchedulingWindow, runtime: string): SchedulingWindow {
  const absolute = [...new Set(message.match(/\d{4}-\d{2}-\d{2}/g) ?? [])];
  if (absolute.length) {
    if (absolute.length !== 1 || !isIsoDate(absolute[0]) || /今天|明天|后天|下(?:个)?(?:周|星期|礼拜)|不行|不要|不能|避开|之前|之后|以后|以前|或/.test(message))
      throw new Error('请明确一个合法目标日期');
    if (absolute[0] < period.startDate || absolute[0] > period.endDate) throw new Error('目标日期超出当前阶段，请先调整阶段日期');
    return getPeriodWeekRange(period.startDate, period.endDate,
      calculatePeriodWeek(period.startDate, period.endDate, absolute[0], period.weekStartsOn), period.weekStartsOn);
  }
  const next = message.match(/下(?:个)?(?:周|星期|礼拜)([一二三四五六日天])?/);
  const relative = [...new Set(message.match(/今天|明天|后天/g) ?? [])];
  if (!next && relative.length !== 1) return fallback;
  if (next && relative.length || /不行|不要|不能|避开|之前|之后|以后|以前/.test(message)) return fallback;
  const date = new Date(`${runtime}T12:00:00Z`);
  const offset = next ? 7 - ((date.getUTCDay() + 6) % 7) + (next[1] ? Math.min('一二三四五六日天'.indexOf(next[1]), 6) : 0)
    : relative[0] === '明天' ? 1 : relative[0] === '后天' ? 2 : 0;
  date.setUTCDate(date.getUTCDate() + offset);
  const target = date.toISOString().slice(0, 10);
  if (target < period.startDate || target > period.endDate) throw new Error('目标日期超出当前阶段，请先调整阶段日期');
  return getPeriodWeekRange(period.startDate, period.endDate,
    calculatePeriodWeek(period.startDate, period.endDate, target, period.weekStartsOn), period.weekStartsOn);
}

export interface TimeReplanGateway {
  proposeTimeMove(context: AgentContext, eventId: string, userMessage: string, durationMinutes?: number | null): Promise<TimeMoveProposal>;
  scheduleTask?(context: AgentContext, taskId: string, userMessage: string, durationMinutes?: number | null): Promise<TimeScheduleProposal>;
  createAndSchedule?(context: AgentContext, userMessage: string): Promise<CreateAndScheduleProposal>;
}

export type TimeMoveResult = {
  status: 'MOVED' | 'SCHEDULED' | 'REJECTED' | 'FAILED' | 'NEEDS_RECONCILIATION';
  message: string;
  before?: TimeMoveProposal['before'];
  after?: TimeMoveProposal['after'];
  operationId?: string;
  eventId?: string | null;
  writeOutcome?: AtomicTimeResult['writeOutcome'];
  readbackVerified?: boolean;
  receipt?: AtomicTimeResult['receipt'];
};

export class TimeReplanService {
  private readonly revising = new Set<string>();
  constructor(private readonly store: GrowthStore, private readonly gateway: TimeReplanGateway,
    private readonly now: () => Date = () => new Date(), private readonly operations?: TimeOperationAdapter) {}

  get canConfirm(): boolean { return this.operations !== undefined; }
  get canCancel(): boolean { return typeof this.operations?.cancel === 'function'; }

  async cancel(input: unknown) {
    if (!this.operations?.cancel) throw new Error('当前数据源不支持取消建议');
    const ref = timeOperationReferenceSchema.parse(input);
    if(this.revising.has(ref.operationId))throw new Error('正在修改候选，请稍候');
    await this.inspectOperation(ref);
    return this.operations.cancel(ref.operationId, ref.contentDigest, this.now());
  }

  async proposeNewTask(userMessage: string, selectedWindow?: SchedulingWindow) {
    if (!userMessage.trim()) throw new Error('请说明要新建的任务和时间');
    if (!this.gateway.createAndSchedule) throw new Error('当前服务不支持新建任务提案');
    const journey = await this.store.getJourney();
    if (!journey?.currentPeriodId) throw new Error('请先选择当前阶段');
    const identity = await this.operations?.captureScope();
    const { period } = await this.loadPeriod(journey.id);
    let window = this.selectedWeek(period, requestedSchedulingWindow(period, userMessage,
      selectedWindow ?? this.currentWeek(period), timeRuntimeDate(this.now())));
    const horizon = this.schedulingHorizon(period);
    if (window.startDate > horizon.endDate) throw new Error('请安排今天起14天内的任务');
    const context = await new AgentContextService(this.store).buildTime({ journeyId: journey.id, date: timeRuntimeDate(this.now()),
      weekIndex: calculatePeriodWeek(period.startDate, period.endDate, window.startDate, period.weekStartsOn) }, horizon);
    const proposal = createAndScheduleProposalSchema.parse(await this.gateway.createAndSchedule(context, userMessage.trim()));
    if (proposal.date < horizon.startDate || proposal.date > horizon.endDate || proposal.date < timeRuntimeDate(this.now()))
      throw new Error('建议日期不属于所选周');
    if (selectedWindow && (proposal.date < window.startDate || proposal.date > window.endDate))
      throw new Error('建议超出用户请求的日期窗口');
    window = this.targetWeek(period, proposal.date);
    const operation = identity && this.operations ? await this.operations.prepare({ operationType: 'CREATE_AND_SCHEDULE', proposal,
      expectedBefore: null, expectedPeriodFacts: this.periodFacts(period),
      scope: { ...identity, journeyId: journey.id, periodId: period.id, weekStart: window.startDate, weekEnd: window.endDate, sessionId: null },
    }, this.now()) : null;
    return { proposal, context, operation };
  }

  async confirmNewTask(input: unknown): Promise<TimeMoveResult> {
    return this.confirmOperation(input, 'CREATE_AND_SCHEDULE');
  }

  private periodFacts(period: Period) {
    return timePeriodFactsSchema.parse({ id: period.id, journeyId: period.journeyId, startDate: period.startDate,
      endDate: period.endDate, status: period.status, weekStartsOn: period.weekStartsOn, currentWeekOverride: period.currentWeekOverride });
  }

  private async loadPeriod(journeyId: string) {
    const journey = await this.store.getJourney();
    if (!journey || journey.id !== journeyId || !journey.currentPeriodId) throw new Error('当前成长旅程或阶段不存在');
    const periods = await this.store.listPeriods(journey.id);
    const period = periods.find((item) => item.id === journey.currentPeriodId);
    if (!period) throw new Error('当前阶段不存在');
    return { journey, period };
  }

  async propose(eventId: string, userMessage: string, selectedWindow?: SchedulingWindow, durationMinutes?: number | null) {
    if (!userMessage.trim()) throw new Error('请告诉智能体你想怎么调整');
    if (durationMinutes != null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 240)) throw new Error('调整时长必须为1至240的整数分钟');
    const journey = await this.store.getJourney();
    if (!journey?.currentPeriodId) throw new Error('请先选择当前阶段');
    const identity = await this.operations?.captureScope();
    const { period } = await this.loadPeriod(journey.id);
    const sourceRows = await this.store.scheduleEvents?.queryByDateRange({periodId:period.id,startDate:period.startDate,endDate:period.endDate});
    const source = sourceRows?.find(row=>row.id===eventId && row.periodId===period.id && row.type==='TASK' && row.source==='USER');
    if(!source)throw new Error('所选时间块已变化或删除');
    if(!isTimeBlockAdjustable(source,await this.store.getTask(source.taskId!),this.now()))throw new Error('原时间块已经开始或任务不可调整');
    const window = this.selectedWeek(period, selectedWindow ?? this.targetWeek(period,source.date));
    const horizon = this.schedulingHorizon(period);
    if(window.startDate>horizon.endDate || window.endDate<horizon.startDate)throw new Error('请调整今天起14天内的时间块');
    const context = await new AgentContextService(this.store).buildTime({ journeyId: journey.id, date: timeRuntimeDate(this.now()),
      weekIndex: calculatePeriodWeek(period.startDate, period.endDate, window.startDate, period.weekStartsOn) });
    const event = context.schedule?.events.find((item) => item.eventId === eventId);
    if (!event) throw new Error('要调整的时间块不在本周');
    if (event.kind !== 'TASK' || !event.adjustable) throw new Error('只有用户创建的任务时间块可以被智能体调整');
    const before = (await this.store.scheduleEvents?.queryByDateRange({ periodId: period.id, ...window }))?.find(item => item.id === eventId);
    const task = await this.store.getTask(event.taskId!);
    if (!before || !task || before.taskId !== task.id || task.periodId !== period.id
      || !['TODO', 'DELAYED'].includes(task.status)) throw new Error('关联任务或事件不存在、状态不可移动');
    const proposal = timeMoveProposalSchema.parse(
      await (durationMinutes == null ? this.gateway.proposeTimeMove(context, eventId, userMessage.trim())
        : this.gateway.proposeTimeMove(context, eventId, userMessage.trim(), durationMinutes)),
    );
    if (proposal.eventId !== eventId || proposal.taskId !== task.id) throw new Error('建议不属于所选任务或事件');
    if(!isTimeBlockAdjustable(before,await this.store.getTask(task.id),this.now()))throw new Error('原时间块已经开始或任务不可调整');
    assertFutureTimeSlot(proposal.after,this.now());
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    if (minutes(proposal.after.endTime) - minutes(proposal.after.startTime)
      !== (durationMinutes ?? minutes(before.endTime) - minutes(before.startTime))) throw new Error('建议时长不符合本次请求');
    const operation = identity && this.operations ? await this.operations.prepare({
      operationType: 'MOVE_TASK_TIME', proposal, expectedBefore: before,
      expectedTaskFacts: taskSnapshotSchema.parse(task), expectedPeriodFacts: this.periodFacts(period),
      scope: { ...identity, journeyId: journey.id, periodId: period.id, weekStart: window.startDate, weekEnd: window.endDate, sessionId: null },
    }, this.now()) : null;
    return { proposal, context, operation };
  }

  async proposeSchedule(taskId: string, userMessage: string, selectedWindow?: SchedulingWindow, availability?: DeclaredAvailability, durationMinutes?: number | null) {
    if (!userMessage.trim()) throw new Error('请告诉智能体你想安排到什么时候');
    if(durationMinutes != null && (!Number.isInteger(durationMinutes) || durationMinutes<1 || durationMinutes>240))throw new Error('排程时长必须为1至240的整数分钟');
    if(availability)availability=declaredAvailabilitySchema.parse(availability);
    const journey = await this.store.getJourney();
    if (!journey?.currentPeriodId) throw new Error('请先选择当前阶段');
    const identity = await this.operations?.captureScope();
    const { period } = await this.loadPeriod(journey.id);
    let window = this.selectedWeek(period, requestedSchedulingWindow(period, userMessage,
      selectedWindow ?? this.currentWeek(period), timeRuntimeDate(this.now())));
    const horizon = this.schedulingHorizon(period);
    if (window.startDate > horizon.endDate) throw new Error('请安排今天起14天内的任务');
    const context = await new AgentContextService(this.store).buildTime({ journeyId: journey.id, date: timeRuntimeDate(this.now()),
      weekIndex: calculatePeriodWeek(period.startDate, period.endDate, window.startDate, period.weekStartsOn) }, horizon);
    const task = context.schedule?.unscheduledTasks.find((item) => item.id === taskId);
    if (!task) throw new Error('要安排的任务不在所选周的合法待安排列表中');
    if (task.status !== 'TODO' && task.status !== 'DELAYED') throw new Error('只能安排未完成任务');
    if (durationMinutes == null && (task.estimatedMinutes === null || task.estimatedMinutes <= 0)) throw new Error('请先填写预计时长');
    if (!this.gateway.scheduleTask) throw new Error('当前 AI 服务不支持安排任务');
    const requestedMinutes=durationMinutes ?? task.estimatedMinutes!;
    const span=(s:{startTime:string;endTime:string})=>(Number(s.endTime.slice(0,2))*60+Number(s.endTime.slice(3)))-(Number(s.startTime.slice(0,2))*60+Number(s.startTime.slice(3)));
    if(availability && span(availability)<requestedMinutes)throw new Error('指定时长超出可用窗口');
    const facts = taskSnapshotSchema.parse(await this.store.getTask(taskId));
    if (facts.periodId !== period.id) throw new Error('任务不属于当前阶段');
    const proposal = timeScheduleProposalSchema.parse(
      await (durationMinutes == null ? this.gateway.scheduleTask(context, taskId, userMessage.trim()) : this.gateway.scheduleTask(context, taskId, userMessage.trim(), durationMinutes)),
    );
    if (proposal.taskId !== taskId || proposal.after.date < horizon.startDate || proposal.after.date > horizon.endDate
      || proposal.after.date < timeRuntimeDate(this.now())) throw new Error('建议不属于所选任务或日期窗口');
    if (selectedWindow && (proposal.after.date < window.startDate || proposal.after.date > window.endDate))
      throw new Error('建议超出用户请求的日期窗口');
    if(span(proposal.after)!==requestedMinutes || proposal.candidates.some(slot=>span(slot)!==requestedMinutes))throw new Error('建议时长不符合本次指定时长');
    if(availability)assertDeclaredAvailability(proposal.after,availability);
    window = this.targetWeek(period, proposal.after.date);
    const operation = identity && this.operations ? await this.operations.prepare({
      operationType: 'CREATE_TASK_TIME', proposal, expectedBefore: null, ...(availability?{availability}:{}), ...(durationMinutes==null?{}:{durationMinutes}),
      expectedTaskFacts: facts, expectedPeriodFacts: this.periodFacts(period),
      scope: { ...identity, journeyId: journey.id, periodId: period.id, weekStart: window.startDate, weekEnd: window.endDate, sessionId: null },
    }, this.now()) : null;
    return { proposal, context, operation };
  }

  async reviseSchedule(input: unknown, target: unknown, reason: string, available: DeclaredAvailability) {
    const ref=timeOperationReferenceSchema.parse(input);
    if(this.revising.has(ref.operationId))throw new Error('正在修改候选，请稍候');
    this.revising.add(ref.operationId);
    try {
    if(!this.operations?.replacePending)throw new Error('当前数据源不支持原子修改候选，请重新生成');
    const before=await this.inspectOperation(input);
    if(before.operationType!=='CREATE_TASK_TIME' || before.status!=='PENDING')throw new Error('只能修改尚未确认的任务安排候选');
    const after=timeSlotSchema.parse(target);
    const availability=assertDeclaredAvailability(after,available);
    if(before.availability && JSON.stringify(availability)!==JSON.stringify(before.availability))throw new Error('可用窗口已变化，请重新生成');
    const journey=await this.store.getJourney();if(!journey)throw new Error('旅程不可用');
    const {period}=await this.loadPeriod(journey.id), horizon=this.schedulingHorizon(period);
    if(after.date<horizon.startDate || after.date>horizon.endDate)throw new Error('修改日期必须在今天起14天内');
    const facts=taskSnapshotSchema.parse(await this.store.getTask(before.expectedTaskFacts.id));
    if(JSON.stringify(facts)!==JSON.stringify(before.expectedTaskFacts))throw new Error('任务事实已变化，请重新生成');
    const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
    if(after.startTime<'08:00'||after.endTime>'22:00'||minutes(after.endTime)-minutes(after.startTime)!== (before.durationMinutes ?? facts.estimatedMinutes))throw new Error('候选时段须保持任务预计时长，且在08:00–22:00内');
    if(!this.store.scheduleEvents)throw new Error('日历不可用');
    const window=this.targetWeek(period,after.date);
    const context=await new AgentContextService(this.store).buildTime({journeyId:journey.id,date:timeRuntimeDate(this.now()),weekIndex:calculatePeriodWeek(period.startDate,period.endDate,after.date,period.weekStartsOn)},horizon);
    if(context.schedule?.events.some(e=>e.date===after.date && e.startTime<after.endTime && after.startTime<e.endTime))throw new Error('修改后的候选时间冲突，未写入安排');
    const now=this.now();
    const proposal=timeScheduleProposalSchema.parse({proposalId:createId('user-edit'),taskId:facts.id,after,candidates:[after],reason:'用户修改候选：'+reason,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+10*60000).toISOString()});
    const operation=await this.operations.replacePending(ref,{operationType:'CREATE_TASK_TIME',proposal,availability,...(before.durationMinutes==null?{}:{durationMinutes:before.durationMinutes}),expectedBefore:null,expectedTaskFacts:facts,expectedPeriodFacts:this.periodFacts(period),scope:{...before.scope,weekStart:window.startDate,weekEnd:window.endDate}},now);
    const persisted=await this.inspectOperation(operation);
    if(persisted.status!=='PENDING')throw new Error('CANDIDATE_CHANGED: 替代候选已关闭');
    return {proposal,context,operation};
    } finally { this.revising.delete(ref.operationId); }
  }
  async readRevisionState(input: unknown) {
    if(!this.operations?.getReplacement)throw new Error('无法读取候选状态');
    const ref=timeOperationReferenceSchema.parse(input);
    const replacement=await this.operations.getReplacement(ref);
    const reference=replacement?{operationId:replacement.operationId,contentDigest:replacement.contentDigest}:ref;
    const record=await this.readOperation(reference,true);
    return {record,reference,validPending:record.status==='PENDING' && +this.now()<Date.parse(record.expiresAt)};
  }
  async confirmSchedule(input: unknown, selectedWindow?: SchedulingWindow): Promise<TimeMoveResult> {
    return this.confirmOperation(input, 'CREATE_TASK_TIME', selectedWindow);
  }

  async confirm(input: unknown): Promise<TimeMoveResult> {
    return this.confirmOperation(input, 'MOVE_TASK_TIME');
  }

  /** Read the immutable local summary; conversation/model fields grant no authority. */
  async inspectOperation(input: unknown) { return this.readOperation(input); }

  private async readOperation(input: unknown, allowExpired = false) {
    if (!this.operations) throw new Error('当前数据空间只支持查看建议');
    const ref = timeOperationReferenceSchema.parse(input);
    const op = await this.operations.getOperation(ref.operationId);
    const journey = await this.store.getJourney();
    const identity = await this.operations.captureScope();
    if (!op || !journey || op.contentDigest !== ref.contentDigest || op.scope.journeyId !== journey.id
      || op.scope.periodId !== journey.currentPeriodId || op.scope.databaseInstanceId !== identity.databaseInstanceId
      || op.scope.dataSpace !== identity.dataSpace || op.scope.epoch !== identity.epoch) throw new Error('建议已失效或不属于当前数据空间，请重新生成');
    if (!allowExpired && op.status === 'PENDING' && this.now().getTime() >= Date.parse(op.expiresAt)) throw new Error('建议已过期，请重新生成');
    return op;
  }

  private async confirmOperation(input: unknown, type: TimeOperationPreparation['operationType'], window?: SchedulingWindow): Promise<TimeMoveResult> {
    if (!this.operations) return { status: 'REJECTED', message: 'TIME_WRITES_DISABLED: 验收阶段，正式 AI 时间写入未开放', writeOutcome: 'NOT_ATTEMPTED' };
    const reference = timeOperationReferenceSchema.safeParse(input);
    if (!reference.success) return { status: 'REJECTED', message: '缺少独立的本地操作授权引用', writeOutcome: 'NOT_ATTEMPTED' };
    const { operationId, contentDigest } = reference.data;
    if(this.revising.has(operationId))return {status:'REJECTED',message:'正在修改候选，请确认最新建议',operationId,writeOutcome:'NOT_ATTEMPTED'};
    let executing = false;
    try {
      const op = await this.operations.getOperation(operationId);
      if (!op || op.contentDigest !== contentDigest || op.operationType !== type
        || window && (window.startDate !== op.scope.weekStart || window.endDate !== op.scope.weekEnd)) {
        return { status: 'REJECTED', message: '操作不存在或确认内容、类型、窗口不匹配', operationId, writeOutcome: 'NOT_ATTEMPTED' };
      }
      executing = true;
      const result = await this.operations.execute(operationId, contentDigest, this.now());
      return { ...result, status: result.status === 'SUCCESS' ? type === 'MOVE_TASK_TIME' ? 'MOVED' : 'SCHEDULED' : result.status,
        message: result.status === 'SUCCESS' ? '原子提交完成，独立读回核验通过'
          : result.reason ?? '写入结果需要只读核验，禁止自动重试',
        before: op.expectedBefore ? { date: op.expectedBefore.date, startTime: op.expectedBefore.startTime, endTime: op.expectedBefore.endTime } : undefined,
        after: op.after };
    } catch {
      return { status: executing ? 'NEEDS_RECONCILIATION' : 'REJECTED', operationId,
        writeOutcome: executing ? 'UNKNOWN' : 'NOT_ATTEMPTED', readbackVerified: false,
        message: '存储操作异常；不要重新生成或重试写入，请使用原 operationId 只读核验' };
    }
  }

  async reconcile(input: unknown): Promise<AtomicTimeResult> {
    if (!this.operations) throw new Error('TIME_WRITES_DISABLED');
    const ref = timeOperationReferenceSchema.parse(input);
    const op = await this.operations.getOperation(ref.operationId);
    if (!op || op.contentDigest !== ref.contentDigest) throw new Error('MISSING_OR_CHANGED_OPERATION');
    return this.operations.reconcile(ref.operationId);
  }

  private currentWeek(period: Period) {
    const index = period.currentWeekOverride ?? calculatePeriodWeek(
      period.startDate, period.endDate, timeRuntimeDate(this.now()), period.weekStartsOn,
    );
    return getPeriodWeekRange(period.startDate, period.endDate, index, period.weekStartsOn);
  }

  private schedulingHorizon(period: Period): SchedulingWindow {
    const startDate = timeRuntimeDate(this.now());
    if (startDate < period.startDate || startDate > period.endDate) throw new Error('运行日期不在当前阶段');
    const end = todayIso(addDays(parseISO(startDate), 13));
    return { startDate, endDate: end < period.endDate ? end : period.endDate };
  }

  private targetWeek(period: Period, date: string): SchedulingWindow {
    return this.selectedWeek(period, getPeriodWeekRange(period.startDate, period.endDate,
      calculatePeriodWeek(period.startDate, period.endDate, date, period.weekStartsOn), period.weekStartsOn));
  }

  private selectedWeek(period: Period, input?: SchedulingWindow): SchedulingWindow {
    const window = input ?? this.currentWeek(period);
    if (period.status !== 'ACTIVE' || !isIsoDate(window.startDate) || !isIsoDate(window.endDate)
      || window.startDate < period.startDate || window.endDate > period.endDate) throw new Error('所选周不属于当前进行中的阶段');
    const index = calculatePeriodWeek(period.startDate, period.endDate, window.startDate, period.weekStartsOn);
    const expected = getPeriodWeekRange(period.startDate, period.endDate, index, period.weekStartsOn);
    if (expected.startDate !== window.startDate || expected.endDate !== window.endDate
      || window.endDate < timeRuntimeDate(this.now())) throw new Error('请选择完整的当前周或未来周窗口');
    return window;
  }
}
