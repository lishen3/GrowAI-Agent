import type { TimeOperation, TimeOperationScope, TimeOperationReference } from '@/domain/replan/timeOperation';
import type { TimeMoveProposal, TimeScheduleProposal, CreateAndScheduleProposal } from '@/domain/replan/timeAgent';

/** Local authorization reference, separate from the Provider's untrusted proposal. */
export { timeOperationReferenceSchema, type TimeOperationReference } from '@/domain/replan/timeOperation';
export type TimeSpaceIdentity = Pick<TimeOperationScope, 'databaseInstanceId' | 'epoch' | 'dataSpace'>;
export type TimeOperationPreparation = {
  scope: TimeOperationScope;
  expectedPeriodFacts: TimeOperation['expectedPeriodFacts'];
  durationMinutes?: TimeOperation['durationMinutes'];
  availability?: TimeOperation['availability'];
} & ({ operationType: 'MOVE_TASK_TIME'; proposal: TimeMoveProposal; expectedBefore: NonNullable<TimeOperation['expectedBefore']>; expectedTaskFacts: TimeOperation['expectedTaskFacts'] }
  | { operationType: 'CREATE_TASK_TIME'; proposal: TimeScheduleProposal; expectedBefore: null; expectedTaskFacts: TimeOperation['expectedTaskFacts'] }
  | { operationType: 'CREATE_AND_SCHEDULE'; proposal: CreateAndScheduleProposal; expectedBefore: null });
export type AtomicTimeResult = {
  operationId: string; eventId: string | null; status: 'SUCCESS' | 'REJECTED' | 'FAILED' | 'NEEDS_RECONCILIATION';
  writeOutcome: 'NOT_ATTEMPTED' | 'ROLLED_BACK' | 'UNKNOWN' | 'COMMITTED'; readbackVerified: boolean;
  receipt?: TimeOperation['receipt']; reason?: string;
};

/** Explicitly injected capability. Native and Demo composition must remain fail-closed. */
export interface TimeOperationAdapter {
  captureScope(): Promise<TimeSpaceIdentity>;
  prepare(input: TimeOperationPreparation, now: Date): Promise<TimeOperationReference>;
  getOperation(id: string): Promise<TimeOperation | null>;
  execute(id: string, confirmedDigest: string, now: Date): Promise<AtomicTimeResult>;
  reconcile(id: string): Promise<AtomicTimeResult>;
  cancel?(id: string, contentDigest: string, now: Date): Promise<TimeOperation>;
  replacePending?(reference: TimeOperationReference, input: TimeOperationPreparation, now: Date): Promise<TimeOperationReference>;
  getReplacement?(reference: TimeOperationReference): Promise<TimeOperation | null>;
}
