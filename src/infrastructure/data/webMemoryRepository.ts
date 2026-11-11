import type { MemoryGateway } from '@/application/memory/MemoryApplicationService';
import type { ReflectionStore } from '@/application/reflection/WeeklyReflectionService';
import { createMemorySchema, normalizeMemoryContent, type Memory } from '@/domain/memory/types';
import { reflectionSchema, type Reflection } from '@/domain/reflection/types';
import { repositoryRuntime, type RepositoryRuntime } from './repositoryRuntime';
import { beginBusinessWrite, type SeedPermit } from './webLifecycle';

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
  });
}

async function write<T>(db: IDBDatabase, stores: string[], work: (transaction: IDBTransaction) => Promise<T>, permit?: SeedPermit): Promise<T> {
  const transaction = await beginBusinessWrite(db, stores, permit);
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
  });
  try {
    const result = await work(transaction);
    await done;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* already closed */ }
    await done.catch(() => undefined);
    throw error;
  }
}

export function createWebMemoryRepository(db: IDBDatabase, runtime: RepositoryRuntime = repositoryRuntime, permit?: SeedPermit): MemoryGateway & ReflectionStore {
  const guardedWrite = <T>(database: IDBDatabase, stores: string[], work: (tx: IDBTransaction) => Promise<T>) => write(database, stores, work, permit);
  return {
    async createMemory(input) {
      const value = createMemorySchema.parse(input);
      return guardedWrite(db, ['journeys', 'memories', 'reflections'], async (transaction) => {
        if (!await requestResult(transaction.objectStore('journeys').get(value.journeyId))) throw new Error('成长旅程不存在');
        if (value.sourceType === 'REFLECTION') {
          const source = await requestResult(transaction.objectStore('reflections').get(value.sourceId!)) as Reflection | undefined;
          if (!source || source.journeyId !== value.journeyId) throw new Error('复盘来源不存在');
        }
        const store = transaction.objectStore('memories');
        const normalizedContent = normalizeMemoryContent(value.content);
        const existing = await requestResult(store.index('dedup').get([value.journeyId, value.type, normalizedContent]));
        if (existing) return existing.record as Memory;
        const now = runtime.now().toISOString();
        const memory: Memory = { ...value, id: runtime.createId('memory'), status: 'ACTIVE', createdAt: now, updatedAt: now };
        await requestResult(store.add({ id: memory.id, journeyId: memory.journeyId, type: memory.type, normalizedContent, record: memory }));
        return memory;
      });
    },
    async listMemories(journeyId) {
      const rows = await requestResult(db.transaction('memories', 'readonly').objectStore('memories').index('journeyId').getAll(journeyId));
      return rows.map((row) => row.record as Memory);
    },
    async archiveMemory(journeyId, memoryId) {
      return guardedWrite(db, ['memories'], async (transaction) => {
        const store = transaction.objectStore('memories');
        const row = await requestResult(store.get(memoryId));
        if (!row || row.journeyId !== journeyId) throw new Error('记忆不存在');
        if (row.record.status !== 'ARCHIVED') {
          row.record = { ...row.record, status: 'ARCHIVED', updatedAt: runtime.now().toISOString() };
          await requestResult(store.put(row));
        }
        return row.record as Memory;
      });
    },
    async saveReflection(input) {
      const value = reflectionSchema.parse(input);
      await guardedWrite(db, ['periods', 'reflections'], async (transaction) => {
        const period = await requestResult(transaction.objectStore('periods').get(value.periodId));
        if (!period || period.journeyId !== value.journeyId) throw new Error('复盘阶段不属于成长旅程');
        await requestResult(transaction.objectStore('reflections').add(value));
      });
    },
    async getReflection(journeyId, reflectionId) {
      const reflection = await requestResult(db.transaction('reflections', 'readonly').objectStore('reflections').get(reflectionId)) as Reflection | undefined;
      return reflection?.journeyId === journeyId ? reflection : null;
    },
    async listReflections(journeyId) {
      const records = await requestResult(db.transaction('reflections', 'readonly').objectStore('reflections').index('journeyId').getAll(journeyId)) as Reflection[];
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
