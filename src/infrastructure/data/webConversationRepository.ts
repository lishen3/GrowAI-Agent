import { conversationSchema, type ConversationRepository, type ConversationScope } from '@/domain/agent/conversation';
import { reflectionSchema } from '@/domain/reflection/types';
import { createId } from '@/shared/id';
import { beginBusinessWrite, readTransactionMetadata } from './webLifecycle';
const read = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
export function createWebConversationRepository(db: IDBDatabase): ConversationRepository {
  async function transaction<T>(scope: ConversationScope, write: boolean, work: (tx: IDBTransaction, epoch: string) => Promise<T>) {
    const stores = ['conversations', 'journeys', 'periods', 'spaceMetadata'];
    if (write) stores.push('reflections');
    const tx = write ? await beginBusinessWrite(db, stores) : db.transaction(stores);
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('会话事务失败')); });
    try {
      const meta = await readTransactionMetadata(tx);
      const period = await read(tx.objectStore('periods').get(scope.periodId));
      const journey = await read(tx.objectStore('journeys').get(scope.journeyId));
      if (meta.state !== 'READY' || !journey || period?.journeyId !== scope.journeyId) throw new Error('会话作用域不可用');
      const result = await work(tx, meta.epoch); await done; return result;
    } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
  }
  const matches = (record: { scope: ConversationScope; epoch: string }, scope: ConversationScope, epoch: string) =>
    record.scope.journeyId === scope.journeyId && record.scope.periodId === scope.periodId && record.epoch === epoch;
  return {
    savesReflectionOnAppend: true,
    list(scope) { return transaction(scope, false, async (tx, epoch) =>
      (await read(tx.objectStore('conversations').getAll()))
        .filter(row => row.scope?.journeyId === scope.journeyId && row.scope?.periodId === scope.periodId && row.epoch === epoch)
        .map(row => conversationSchema.parse(row)).filter(row => matches(row, scope, epoch)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))); },
    create(scope) { return transaction(scope, true, async (tx, epoch) => {
      const now = new Date().toISOString();
      const row = conversationSchema.parse({ id: createId('conversation'), scope, epoch, createdAt: now, updatedAt: now, messages: [] });
      await read(tx.objectStore('conversations').add(row)); return row;
    }); },
    append(scope, id, message) { return transaction(scope, true, async (tx, epoch) => {
      const before = conversationSchema.parse(await read(tx.objectStore('conversations').get(id)));
      if (!matches(before, scope, epoch)) throw new Error('旧会话已失效');
      if (before.messages.some(row => row.id === message.id)) return before;
      if (message.reflection && message.status === 'complete' && message.requestId) {
        const reflection = reflectionSchema.parse(message.reflection);
        if (reflection.journeyId !== scope.journeyId || reflection.periodId !== scope.periodId) throw new Error('复盘作用域不匹配');
        const reflections = tx.objectStore('reflections');
        const existing = await read(reflections.get(reflection.id));
        if (existing) {
          if (existing.journeyId !== scope.journeyId || existing.periodId !== scope.periodId) throw new Error('复盘记录作用域不匹配');
          message = { ...message, reflection: reflectionSchema.parse(existing) };
        } else {
          await read(reflections.add(reflection));
        }
      }
      const row = conversationSchema.parse({ ...before, updatedAt: new Date().toISOString(), messages: [...before.messages, message] });
      await read(tx.objectStore('conversations').put(row)); return row;
    }); },
    clear(scope) { return transaction(scope, true, async tx => {
      for (const row of await read(tx.objectStore('conversations').getAll())) {
        if (row.scope.journeyId === scope.journeyId && row.scope.periodId === scope.periodId) await read(tx.objectStore('conversations').delete(row.id));
      }
    }); },
  };
}
