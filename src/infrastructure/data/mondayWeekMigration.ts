import type { DatabaseLike } from '@/infrastructure/db/types';
import { beginBusinessWrite, invalidatePendingOperations, readSpaceMetadata } from './webLifecycle';
import type { Period } from '@/domain/periods/types';

/** Legacy importer was the only in-app producer of Sunday starts; preserve every dated record. */
export async function correctWebWeekStarts(db: IDBDatabase): Promise<void> {
  if ((await readSpaceMetadata(db)).state !== 'READY') return;
  const existing = await new Promise<Period[]>((resolve, reject) => {
    const request = db.transaction('periods').objectStore('periods').getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  if (!existing.some(period => period.weekStartsOn === 7)) return;
  const tx = await beginBusinessWrite(db, ['periods']);
  const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('WEEK_MIGRATION_ABORT')); });
  void done.catch(() => undefined);
  const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    const periods = await read(tx.objectStore('periods').getAll()) as Period[];
    const changed = periods.filter(period => period.weekStartsOn === 7);
    for (const period of changed) await read(tx.objectStore('periods').put({ ...period, weekStartsOn: 1 }));
    if (changed.length) await invalidatePendingOperations(tx);
    await done;
  } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
}

export async function correctNativeWeekStarts(db: DatabaseLike): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE period SET week_starts_on = 1 WHERE week_starts_on = 7');
  });
}
