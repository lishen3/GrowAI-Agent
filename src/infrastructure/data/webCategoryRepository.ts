import { categorySchema, defaultCategories, normalizeCategoryName, type ActionCategory, type CategoryRepository } from '@/domain/categories/types';
import { beginBusinessWrite, readTransactionMetadata } from './webLifecycle';
import { createId } from '@/shared/id';

const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
export async function requireWebCategory(tx: IDBTransaction, journeyId: string, id: string, allowArchived = false) {
  const saved = await read(tx.objectStore('categories').get([journeyId,id]));
  const value = saved ?? defaultCategories(journeyId).find(row => row.id === id);
  if (!value || (!allowArchived && value.status !== 'ACTIVE')) throw new Error('分类不存在、已归档或不属于当前旅程');
  return categorySchema.parse(value);
}
/** Store keyed by [journeyId,id], installed by Web migration v9. */
export function createWebCategoryRepository(db: IDBDatabase): CategoryRepository {
  const listeners = new Set<() => void>();
  async function transact<T>(journeyId: string, write: boolean, work: (tx: IDBTransaction, rows: ActionCategory[]) => Promise<T>) {
    const stores = ['categories', 'journeys', 'spaceMetadata'];
    const tx = write ? await beginBusinessWrite(db, stores) : db.transaction(stores);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('分类事务失败'));
    });
    try {
      const metadata = await readTransactionMetadata(tx);
      if (metadata.state !== 'READY' || !await read(tx.objectStore('journeys').get(journeyId))) throw new Error('分类数据空间不可用');
      const saved = (await read(tx.objectStore('categories').getAll())).filter(row => row.journeyId === journeyId).map(row => categorySchema.parse(row));
      const rows = [...new Map([...defaultCategories(journeyId), ...saved].map(row => [row.id, row])).values()];
      const result = await work(tx, rows); await done;
      if (write) for (const listener of listeners) listener();
      return result;
    } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
  }
  async function save(tx: IDBTransaction, rows: ActionCategory[], value: ActionCategory) {
    const parsed = categorySchema.parse(value);
    if (rows.some(row => row.id !== parsed.id && row.normalizedName === parsed.normalizedName)) throw new Error('分类名称已存在（包括已归档分类）');
    await read(tx.objectStore('categories').put(parsed)); return parsed;
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    list(journeyId) { return transact(journeyId, false, async (_, rows) => rows.sort((a,b) => a.sortOrder - b.sortOrder)); },
    create(journeyId, name) { return transact(journeyId, true, async (tx, rows) => {
      const now = new Date().toISOString();
      return save(tx, rows, { id: createId('category'), journeyId, name: name.trim(), normalizedName: normalizeCategoryName(name),
        system: false, status: 'ACTIVE', sortOrder: Math.max(0, ...rows.map(row => row.sortOrder)) + 1, createdAt: now, updatedAt: now });
    }); },
    update(journeyId, id, changes) { return transact(journeyId, true, async (tx, rows) => {
      const before = rows.find(row => row.id === id);
      if (!before) throw new Error('分类不存在');
      if (before.system) throw new Error('系统分类不可重命名或归档');
      return save(tx, rows, { ...before, ...changes, name: changes.name?.trim() ?? before.name,
        normalizedName: changes.name === undefined ? before.normalizedName : normalizeCategoryName(changes.name), updatedAt: new Date().toISOString() });
    }); },
  };
}
