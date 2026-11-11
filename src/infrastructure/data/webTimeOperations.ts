import { timeOperationSchema, timeOperationReferenceSchema, replacementOperationId, assertDeclaredAvailability, assertTimeTransition, validateTimeTarget, type TimeOperation } from '@/domain/replan/timeOperation';
import { sameContent } from '@/domain/replan/execution';
import { calculatePeriodWeek, getPeriodWeekRange } from '@/shared/date';
import { timeRuntimeDate, assertFutureTimeSlot } from '@/domain/replan/timeRuntime';
import { projectCoursesForWeek } from '@/domain/courses/projectCourseWeek';
import { detectScheduleConflicts } from '@/domain/scheduling/detectScheduleConflicts';
import { scheduleEventSchema, type ScheduleEvent } from '@/domain/scheduling/types';
import { timePeriodFactsSchema } from '@/domain/replan/timeProposal';
import { readTransactionMetadata } from './webLifecycle';
import { createId } from '@/shared/id';
import { beginBusinessWrite } from './webLifecycle';
import { timeMoveProposalSchema, timeScheduleProposalSchema, createAndScheduleProposalSchema } from '@/domain/replan/timeAgent';
import { validateCreateTask } from '@/domain/tasks/rules';
import { taskSnapshotSchema } from '@/domain/tasks/dateOnly';
import type { AtomicTimeResult, TimeOperationPreparation } from '@/application/replan/TimeOperationAdapter';
export type { AtomicTimeResult } from '@/application/replan/TimeOperationAdapter';

const stores = ['timeOperations', 'spaceMetadata', 'journeys', 'periods', 'tasks', 'scheduleEvents', 'courses'];
class RolledBackTransaction extends Error {}
const read = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, item]) => [k, sort(item)])) : v;
  return JSON.stringify(sort(value));
}
export async function timeContentDigest(op: TimeOperation): Promise<string> {
  const { contentDigest: _digest, status: _status, decidedAt: _decided, receipt: _receipt, ...immutable } = op;
  const bytes = new TextEncoder().encode(canonical(immutable));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
/** One IndexedDB commit for business records and the durable operation receipt. */
export function createWebTimeOperations(db: IDBDatabase) {
  async function transaction<T>(work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = await beginBusinessWrite(db, stores);
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('TIME_TRANSACTION_ABORT')); });
    void done.catch(() => undefined);
    try { const result = await work(tx); await done; return result; }
    catch (e) {
      try { tx.abort(); } catch { /* completion may be unknown until done settles */ }
      try { await done; } catch { throw new RolledBackTransaction(e instanceof Error ? e.message : 'TIME_TRANSACTION_ABORT'); }
      throw e;
    }
  }
  async function metadata(tx: IDBTransaction, op: TimeOperation) {
    const meta = await readTransactionMetadata(tx);
    if (db.name !== 'growai-pwa' || op.scope.dataSpace !== 'PERSONAL' || meta?.state !== 'READY'
      || meta.mutationOwner != null || meta.resetToken != null
      || meta.databaseInstanceId !== op.scope.databaseInstanceId || meta.epoch !== op.scope.epoch) throw new Error('TIME_LIFECYCLE_NOT_READY');
  }
  async function captureScope() {
    const meta = await readTransactionMetadata(db.transaction('spaceMetadata', 'readonly'));
    if (db.name !== 'growai-pwa' || meta.state !== 'READY' || meta.mutationOwner !== null || meta.resetToken !== null) {
      throw new Error('TIME_LIFECYCLE_NOT_READY');
    }
    return { databaseInstanceId: meta.databaseInstanceId, epoch: meta.epoch, dataSpace: 'PERSONAL' as const };
  }
  async function prepare(input: TimeOperationPreparation, now: Date) {
    if (input.operationType === 'CREATE_AND_SCHEDULE') {
      const proposal = createAndScheduleProposalSchema.parse(input.proposal);
      if (Date.parse(proposal.createdAt) > now.getTime()) throw new Error('PROPOSAL_FACTS_MISMATCH');
      const task = taskSnapshotSchema.parse({ id: createId('task'), periodId: input.scope.periodId,
        title: proposal.taskTitle, category: 'CUSTOM', priority: 'B', status: 'TODO', plannedDate: proposal.date,
        estimatedMinutes: (Number(proposal.endTime.slice(0, 2)) * 60 + Number(proposal.endTime.slice(3)))
          - (Number(proposal.startTime.slice(0, 2)) * 60 + Number(proposal.startTime.slice(3))),
        periodGoalId: null, weeklyGoalId: null, description: null, deadline: null,
        createdAt: now.toISOString(), startedAt: null, completedAt: null });
      validateCreateTask(task);
      const op = await register(timeOperationSchema.parse({ operationId: createId('time_operation'),
        providerProposalId: proposal.proposalId, operationType: input.operationType, scope: input.scope,
        createdAt: now.toISOString(), expiresAt: new Date(Math.min(Date.parse(proposal.expiresAt), +now + 15 * 60_000)).toISOString(),
        contentDigest: '0'.repeat(64), status: 'PENDING', eventId: createId('schedule'), expectedTaskFacts: task,
        expectedPeriodFacts: input.expectedPeriodFacts, expectedBefore: null,
        after: { date: proposal.date, startTime: proposal.startTime, endTime: proposal.endTime }, decidedAt: null, receipt: null }), now);
      return { operationId: op.operationId, contentDigest: op.contentDigest };
    }
    const proposal = input.operationType === 'MOVE_TASK_TIME'
      ? timeMoveProposalSchema.parse(input.proposal) : timeScheduleProposalSchema.parse(input.proposal);
    if (proposal.taskId !== input.expectedTaskFacts.id || Date.parse(proposal.createdAt) > now.getTime()) throw new Error('PROPOSAL_FACTS_MISMATCH');
    if (input.operationType === 'MOVE_TASK_TIME' && (input.proposal.eventId !== input.expectedBefore.id
      || !sameContent(input.proposal.before, { date: input.expectedBefore.date, startTime: input.expectedBefore.startTime,
        endTime: input.expectedBefore.endTime }))) throw new Error('PROPOSAL_EVENT_MISMATCH');
    const op = await register(timeOperationSchema.parse({
      operationId: createId('time_operation'), providerProposalId: proposal.proposalId,
      operationType: input.operationType, scope: input.scope,
      createdAt: now.toISOString(), expiresAt: new Date(Math.min(Date.parse(proposal.expiresAt), now.getTime() + 15 * 60_000)).toISOString(),
      contentDigest: '0'.repeat(64), status: 'PENDING',
      eventId: input.expectedBefore?.id ?? createId('schedule'), expectedTaskFacts: input.expectedTaskFacts,
      expectedPeriodFacts: input.expectedPeriodFacts, expectedBefore: input.expectedBefore,
      after: proposal.after, decidedAt: null, receipt: null, ...(input.availability ? {availability:input.availability} : {}), ...(input.durationMinutes==null?{}:{durationMinutes:input.durationMinutes}),
    }), now);
    return { operationId: op.operationId, contentDigest: op.contentDigest };
  }
  async function getOperation(id: string): Promise<TimeOperation | null> {
    const row = await read(db.transaction('timeOperations', 'readonly').objectStore('timeOperations').get(id));
    return row ? timeOperationSchema.parse(row) : null;
  }
  async function register(input: TimeOperation, now = new Date()) {
    const parsed = timeOperationSchema.parse(input);
    if (parsed.status !== 'PENDING') throw new Error('ONLY_PENDING_CAN_REGISTER');
    const op = { ...parsed, contentDigest: await timeContentDigest(parsed) };
    return transaction(async tx => {
      await metadata(tx, op);
      const existing = await read(tx.objectStore('timeOperations').get(op.operationId));
      if (existing) { if (!sameContent(existing, op)) throw new Error('OPERATION_ALREADY_REGISTERED'); return timeOperationSchema.parse(existing); }
      // Fresh DB facts, not Provider facts, authorize registration. Repeated at commit.
      await validateFacts(tx, op, now);
      await read(tx.objectStore('timeOperations').add(op));
      return op;
    });
  }
  async function validateFacts(tx: IDBTransaction, op: TimeOperation, now: Date): Promise<ScheduleEvent> {
    if (op.status !== 'PENDING' || !Number.isFinite(now.getTime()) || now.getTime() < Date.parse(op.createdAt)
      || now.getTime() >= Date.parse(op.expiresAt)) throw new Error('NOT_PENDING_OR_EXPIRED');
    const period = await read(tx.objectStore('periods').get(op.scope.periodId));
    const journey = await read(tx.objectStore('journeys').get(op.scope.journeyId));
    if (!period || !journey || journey.currentPeriodId !== period.id || period.journeyId !== journey.id
      || !sameContent(timePeriodFactsSchema.parse({ id: period.id, journeyId: period.journeyId,
        startDate: period.startDate, endDate: period.endDate, status: period.status,
        weekStartsOn: period.weekStartsOn, currentWeekOverride: period.currentWeekOverride }), op.expectedPeriodFacts)) throw new Error('PERIOD_CHANGED');
    const window = getPeriodWeekRange(period.startDate, period.endDate,
      calculatePeriodWeek(period.startDate, period.endDate, op.scope.weekStart, period.weekStartsOn), period.weekStartsOn);
    const runtime = timeRuntimeDate(now);
    if (Date.parse(`${op.after.date}T00:00:00Z`) - Date.parse(`${runtime}T00:00:00Z`) > 13 * 86400000) throw new Error('OUTSIDE_SCHEDULING_HORIZON');
    assertFutureTimeSlot(op.after, now);
    if (window.startDate !== op.scope.weekStart || window.endDate !== op.scope.weekEnd || op.after.date < runtime
      || runtime < period.startDate || runtime > period.endDate) throw new Error('INVALID_WINDOW');
    const existingTask = await read(tx.objectStore('tasks').get(op.expectedTaskFacts.id));
    const task = op.operationType === 'CREATE_AND_SCHEDULE' ? op.expectedTaskFacts : existingTask;
    const event = await read(tx.objectStore('scheduleEvents').get(op.eventId));
    if (op.operationType === 'CREATE_AND_SCHEDULE') {
      if (existingTask || event) throw new Error('TASK_OR_EVENT_ALREADY_EXISTS');
      validateCreateTask(task);
      const tasks = await read(tx.objectStore('tasks').index('periodId').getAll(period.id));
      if (tasks.some(t => t.title.trim().toLowerCase() === task.title.trim().toLowerCase())) throw new Error('TASK_TITLE_ALREADY_EXISTS');
    } else validateTimeTarget(op, task, event);
    const saved = (await read(tx.objectStore('scheduleEvents').index('periodDate').getAll(
      IDBKeyRange.bound([period.id, window.startDate], [period.id, window.endDate])))).map(row => scheduleEventSchema.parse(row));
    if (op.operationType === 'CREATE_TASK_TIME' && event) throw new Error('EVENT_ALREADY_EXISTS');
    if (op.expectedBefore && op.expectedBefore.date < runtime) throw new Error('PAST_EVENT');
    const courses = await read(tx.objectStore('courses').index('periodId').getAll(period.id));
    const next: ScheduleEvent = op.operationType === 'MOVE_TASK_TIME' ? { ...op.expectedBefore!, ...op.after }
      : { id: op.eventId, periodId: period.id, taskId: task.id, title: task.title, type: 'TASK', source: 'USER', ...op.after };
    const others = [...saved.filter(e => e.id !== op.eventId), ...projectCoursesForWeek(courses, window.startDate, window.endDate,
      { periodStart: period.startDate, weekStartsOn: period.weekStartsOn })];
    if (detectScheduleConflicts([...others, next]).some(c => c.eventAId === next.id || c.eventBId === next.id)) throw new Error('TIME_CONFLICT');
    return next;
  }
  async function reconcile(id: string): Promise<AtomicTimeResult> {
    const row = await getOperation(id);
    if (!row || row.status !== 'COMMITTED' || await timeContentDigest(row) !== row.contentDigest) return { operationId: id, eventId: row?.eventId ?? null, status: 'NEEDS_RECONCILIATION', writeOutcome: 'UNKNOWN', readbackVerified: false };
    let verified = false;
    try {
      const tx = db.transaction(['spaceMetadata', 'scheduleEvents', 'tasks'], 'readonly');
      await metadata(tx, row);
      const current = await read(tx.objectStore('scheduleEvents').get(row.eventId));
      const expected = row.operationType === 'MOVE_TASK_TIME' ? { ...row.expectedBefore!, ...row.after }
        : { id: row.eventId, periodId: row.scope.periodId, taskId: row.expectedTaskFacts.id,
          type: 'TASK', source: 'USER', title: row.expectedTaskFacts.title, ...row.after };
      verified = sameContent(current, expected);
      if (row.operationType === 'CREATE_AND_SCHEDULE') verified = verified
        && sameContent(await read(tx.objectStore('tasks').get(row.expectedTaskFacts.id)), row.expectedTaskFacts);
    } catch { /* receipt remains committed even if independent readback is unavailable */ }
    return { operationId: id, eventId: row.eventId, receipt: row.receipt, status: verified ? 'SUCCESS' : 'NEEDS_RECONCILIATION', writeOutcome: 'COMMITTED', readbackVerified: verified };
  }
  async function execute(id: string, confirmedDigest: string, now = new Date()): Promise<AtomicTimeResult> {
    let attempted = false;
    let eventId: string | null = null;
    let committed: TimeOperation | null = null;
    try {
      const snapshot = await getOperation(id);
      if (!snapshot || confirmedDigest !== snapshot.contentDigest || await timeContentDigest(snapshot) !== snapshot.contentDigest) throw new Error('MISSING_OR_CHANGED_OPERATION');
      eventId = snapshot.eventId;
      // A receipt replay is read-only, even when this connection's write lease is stale.
      if (snapshot.status === 'COMMITTED') return reconcile(id);
      // Hashing is outside IDB. The exact hashed record is compared again inside the transaction.
      committed = await transaction(async tx => {
        const op = timeOperationSchema.parse(await read(tx.objectStore('timeOperations').get(id)));
        assertTimeTransition(snapshot, op);
        await metadata(tx, op);
        if (op.status === 'COMMITTED') return op;
        const next = await validateFacts(tx, op, now);
        const completed = timeOperationSchema.parse({ ...op, status: 'COMMITTED', decidedAt: now.toISOString(), receipt: { eventId: op.eventId, committedAt: now.toISOString() } });
        assertTimeTransition(op, completed);
        attempted = true;
        if (op.operationType === 'CREATE_AND_SCHEDULE') await read(tx.objectStore('tasks').add(op.expectedTaskFacts));
        await read(tx.objectStore('scheduleEvents')[op.operationType === 'MOVE_TASK_TIME' ? 'put' : 'add'](next));
        await read(tx.objectStore('timeOperations').put(completed));
        return completed;
      });
    } catch (e) {
      const rolledBack = attempted && e instanceof RolledBackTransaction;
      return { operationId: id, eventId, status: rolledBack ? 'FAILED' : attempted ? 'NEEDS_RECONCILIATION' : 'REJECTED',
        writeOutcome: rolledBack ? 'ROLLED_BACK' : attempted ? 'UNKNOWN' : 'NOT_ATTEMPTED', readbackVerified: false, reason: e instanceof Error ? e.message : 'TIME_STORAGE_ERROR' };
    }
    try {
      const result = await reconcile(id);
      if (result.writeOutcome === 'COMMITTED') return result;
    } catch { /* Known oncomplete knowledge must survive any readback failure. */ }
    return { operationId: id, eventId, receipt: committed?.receipt, status: 'NEEDS_RECONCILIATION', writeOutcome: 'COMMITTED', readbackVerified: false };
  }
  async function cancel(id: string, digest: string, now: Date): Promise<TimeOperation> {
    const snapshot = await getOperation(id);
    if (!snapshot || snapshot.contentDigest !== digest || await timeContentDigest(snapshot) !== digest) throw new Error('MISSING_OR_CHANGED_OPERATION');
    if (snapshot.status === 'COMMITTED') throw new Error('ALREADY_COMMITTED: 安排已经保存，请到日历查看');
    if (snapshot.status !== 'PENDING') return snapshot;
    return transaction(async tx => {
      const row = timeOperationSchema.parse(await read(tx.objectStore('timeOperations').get(id)));
      assertTimeTransition(snapshot, row); await metadata(tx, row);
      if (row.status === 'COMMITTED') throw new Error('ALREADY_COMMITTED: 安排已经保存，请到日历查看');
      if (row.status !== 'PENDING') return row;
      if (now.getTime() < Date.parse(row.createdAt)) throw new Error('INVALID_CLOCK');
      const cancelled = timeOperationSchema.parse({ ...row, status: now.getTime() >= Date.parse(row.expiresAt) ? 'EXPIRED' : 'CANCELLED',
        decidedAt: now.toISOString() });
      assertTimeTransition(row, cancelled);
      await read(tx.objectStore('timeOperations').put(cancelled)); return cancelled;
    });
  }
  async function getReplacement(input: unknown): Promise<TimeOperation | null> {
    const ref=timeOperationReferenceSchema.parse(input), old=await getOperation(ref.operationId);
    if(!old || old.contentDigest!==ref.contentDigest || await timeContentDigest(old)!==ref.contentDigest)throw new Error('MISSING_OR_CHANGED_OPERATION');
    await metadata(db.transaction('spaceMetadata','readonly'),old);
    const row=await getOperation(replacementOperationId(old.operationId));
    if(row && (await timeContentDigest(row)!==row.contentDigest || !row.providerProposalId.startsWith(`replacement:${old.operationId}:`)))throw new Error('CANDIDATE_CHANGED: 替代候选已变化');
    return row;
  }
  async function replacePending(reference: unknown, input: TimeOperationPreparation, now: Date) {
    const ref=timeOperationReferenceSchema.parse(reference), old=await getOperation(ref.operationId);
    if(!old || old.contentDigest!==ref.contentDigest || await timeContentDigest(old)!==ref.contentDigest)throw new Error('MISSING_OR_CHANGED_OPERATION');
    if(old.operationType!=='CREATE_TASK_TIME' || input.operationType!=='CREATE_TASK_TIME')throw new Error('INVALID_REPLACEMENT_TYPE');
    const proposal=timeScheduleProposalSchema.parse(input.proposal);
    if(Date.parse(proposal.createdAt)>+now)throw new Error('PROPOSAL_FACTS_MISMATCH');
    const availability=assertDeclaredAvailability(proposal.after,input.availability);
    if(input.durationMinutes!==old.durationMinutes)throw new Error('REPLACEMENT_DURATION_CHANGED');
    if(old.availability && !sameContent(old.availability,availability))throw new Error('可用窗口已变化，请重新生成');
    if(proposal.taskId!==old.expectedTaskFacts.id || !sameContent(input.expectedTaskFacts,old.expectedTaskFacts)
      || !sameContent(input.expectedPeriodFacts,old.expectedPeriodFacts)
      || !sameContent({...input.scope,weekStart:old.scope.weekStart,weekEnd:old.scope.weekEnd},old.scope))throw new Error('REPLACEMENT_FACTS_CHANGED');
    const replay=await getReplacement(ref);
    if(replay) {
      if(old.status!=='CANCELLED' || replay.providerProposalId!==`replacement:${old.operationId}:${proposal.proposalId}` || !sameContent(replay.after,proposal.after) || !sameContent(replay.availability,availability))throw new Error('CANDIDATE_CHANGED: 候选已变化');
      return {operationId:replay.operationId,contentDigest:replay.contentDigest}; // Read-only idempotent replay, never creates authority.
    }
    const parsed=timeOperationSchema.parse({operationId:replacementOperationId(old.operationId),providerProposalId:`replacement:${old.operationId}:${proposal.proposalId}`,
      operationType:'CREATE_TASK_TIME',scope:input.scope,expectedTaskFacts:input.expectedTaskFacts,expectedPeriodFacts:input.expectedPeriodFacts,
      ...(old.durationMinutes==null?{}:{durationMinutes:old.durationMinutes}),expectedBefore:null,eventId:`${old.eventId}:replacement`,after:proposal.after,availability,
      createdAt:now.toISOString(),expiresAt:new Date(Math.min(Date.parse(old.expiresAt),Date.parse(proposal.expiresAt),+now+15*60000)).toISOString(),
      contentDigest:'0'.repeat(64),status:'PENDING',decidedAt:null,receipt:null});
    const next={...parsed,contentDigest:await timeContentDigest(parsed)};
    try {
      await transaction(async tx=>{
        const current=timeOperationSchema.parse(await read(tx.objectStore('timeOperations').get(old.operationId)));
        await metadata(tx,current);
        if(!sameContent(current,old) || current.status!=='PENDING' || current.contentDigest!==ref.contentDigest)throw new Error('CANDIDATE_CHANGED: 候选已变化');
        if(+now<Date.parse(current.createdAt) || +now>=Date.parse(current.expiresAt))throw new Error('NOT_PENDING_OR_EXPIRED');
        if(await read(tx.objectStore('timeOperations').get(next.operationId)))throw new Error('CANDIDATE_CHANGED: 候选已变化');
        await validateFacts(tx,next,now);
        const cancelled=timeOperationSchema.parse({...current,status:'CANCELLED',decidedAt:now.toISOString()});
        assertTimeTransition(current,cancelled);
        await read(tx.objectStore('timeOperations').put(cancelled));
        await read(tx.objectStore('timeOperations').add(next));
      });
    } catch(e) {
      if(e instanceof Error && /STALE_DATA_CONNECTION/.test(e.message)) {
        const actual=await getOperation(ref.operationId);
        if(actual?.status!=='PENDING')throw new Error('CANDIDATE_CHANGED: 候选已在另一页面变化');
      }
      throw e;
    }
    return {operationId:next.operationId,contentDigest:next.contentDigest};
  }
  return { captureScope, prepare, register, getOperation, execute, reconcile, cancel, replacePending, getReplacement };
}
