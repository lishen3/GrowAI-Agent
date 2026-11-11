import type { DatabaseLike } from './types';

/** Every statement is bound to the exclusive transaction, never the root handle. */
export async function exclusiveWrite<T>(db: DatabaseLike, work: (tx: DatabaseLike) => Promise<T>): Promise<T> {
  if (!db.withExclusiveTransactionAsync) throw new Error('EXCLUSIVE_TRANSACTION_REQUIRED');
  let result!: T;
  await db.withExclusiveTransactionAsync(async tx => { const scoped: DatabaseLike = { execAsync: tx.execAsync.bind(tx), runAsync: tx.runAsync.bind(tx), getFirstAsync: tx.getFirstAsync.bind(tx), getAllAsync: tx.getAllAsync.bind(tx), withTransactionAsync: async nested => { await nested(); } }; result = await work(scoped); });
  return result;
}
