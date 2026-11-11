import { DemoPlanningService } from '@/application/replan/DemoPlanningService';
import { ReplanExecutionService, type ExecutionApprovalGateway } from '@/application/replan/ReplanExecutionService';
import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { sameContent, type ApprovedChangeSet } from '@/domain/replan/execution';
import { isDemoWebGrowthStore } from '@/infrastructure/data/webDatabase';
import { DemoApprovalBackendClient } from './DemoApprovalBackendClient';

// Only the store opened from the separate Demo IndexedDB can be a write target.
export function createDemoExecutionService(store: GrowthStore, planning: DemoPlanningService,
  client: DemoApprovalBackendClient, isCurrentSession: () => boolean, clock: () => Date = () => new Date()) {
  function guard() {
    if (!isDemoWebGrowthStore(store) || !isCurrentSession()) throw new Error('DEMO_EXECUTION_SCOPE_INVALID');
  }
  const gateway: ExecutionApprovalGateway = {
    async getApproval(id) { guard(); return client.executionAuthority(id); },
    async validateFresh(changeSet: ApprovedChangeSet) {
      guard();
      const snapshot = await planning.load(true);
      const scope = changeSet.scope;
      if (scope.dataSpace !== 'DEMO' || scope.sessionId !== snapshot.session?.sessionId
        || scope.resetEpoch !== snapshot.session.resetEpoch || scope.journeyId !== snapshot.context.journey.id
        || scope.periodId !== snapshot.context.currentPeriod.id
        || !sameContent(snapshot.tasks.find((task) => task.id === changeSet.expectedTaskFacts.id), changeSet.expectedTaskFacts)) {
        throw new Error('DEMO_EXECUTION_FACTS_CHANGED');
      }
      const result = await client.prepareExecution(changeSet, snapshot);
      guard();
      return result;
    },
  };
  // Guard again immediately before the real narrow Application Service call.
  const tasks = new TaskApplicationService({ ...store,
    async getTask(id) { guard(); return store.getTask(id); },
    async updateTaskDateOnly(input) {
      guard();
      if (!store.updateTaskDateOnly) throw new Error('DATE_ONLY_GATEWAY_UNAVAILABLE');
      return store.updateTaskDateOnly(input);
    },
  });
  return new ReplanExecutionService(tasks, gateway, clock);
}
