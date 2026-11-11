import type { GrowthStore } from './GrowthStore';

/** Local maintenance only; storage enforces dependencies and lifecycle inside its transaction. */
export class LocalDataMaintenanceService {
  constructor(private readonly store: GrowthStore) {}
  deleteTask(taskId: string, periodId: string) {
    if (!this.store.deleteUnscheduledTask) throw new Error('当前数据源不支持安全删除');
    return this.store.deleteUnscheduledTask(taskId, periodId);
  }
  clear() {
    if (!this.store.clearLocalData) throw new Error('当前数据源不支持安全清空');
    return this.store.clearLocalData();
  }
}
