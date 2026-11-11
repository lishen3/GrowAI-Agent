import { z } from 'zod';
import { createId } from '@/shared/id';
import { todayIso } from '@/shared/date';

export const BUSINESS_STORES = ['journeys', 'periods', 'goals', 'periodGoals', 'weeklyGoals', 'tasks',
  'taskExecutions', 'achievements', 'memories', 'reflections', 'scheduleEvents', 'courses', 'conversations', 'categories'] as const;
const metadataSchema = z.object({
  id: z.literal('time'), databaseInstanceId: z.string().min(1), epoch: z.string().regex(/^[1-9]\d*$/),
  state: z.enum(['READY', 'BLOCKED', 'RESETTING', 'FAILED']),
  mutationOwner: z.string().min(1).nullable().default(null),
  resetToken: z.string().min(1).nullable().default(null),
  source: z.enum(['personal', 'demo-seed', 'imported']).optional(), protocolVersion: z.literal(1).optional(),
  suppressInitialSeed: z.boolean().optional(),
  revision: z.string().regex(/^[1-9]\d*$/).optional(),
}).refine(meta => meta.state === 'RESETTING'
  ? meta.mutationOwner !== null && meta.resetToken !== null
  : meta.state !== 'READY' || meta.mutationOwner === null && meta.resetToken === null, 'INCONSISTENT_LIFECYCLE_STATE');
export type SpaceMetadata = z.infer<typeof metadataSchema>;
type ConnectionStamp = Pick<SpaceMetadata, 'databaseInstanceId' | 'epoch'> & { revision: string };
const connections = new WeakMap<IDBDatabase, ConnectionStamp>();
const listeners = new Map<string, Set<() => void>>();
const stamp = (meta: SpaceMetadata): ConnectionStamp => ({ databaseInstanceId: meta.databaseInstanceId,
  epoch: meta.epoch, revision: meta.revision ?? '1' });
const matches = (left: ConnectionStamp, meta: SpaceMetadata) => left.databaseInstanceId === meta.databaseInstanceId
  && left.epoch === meta.epoch && left.revision === (meta.revision ?? '1');

/** Bind once per connection. Only trusted bootstrap/reset may explicitly rebind before publishing a Store. */
export async function bindBusinessConnection(db: IDBDatabase, bootstrap = false) {
  if (!connections.has(db) || bootstrap) connections.set(db, stamp(await readSpaceMetadata(db)));
}
export async function isBusinessConnectionCurrent(db: IDBDatabase): Promise<boolean> {
  const current = await readSpaceMetadata(db);
  // A preceding write on this connection may commit while the metadata read is queued.
  const expected = connections.get(db);
  return !!expected && current.state === 'READY' && matches(expected, current);
}
function notifySpaceChange(db: IDBDatabase) {
  for (const notify of listeners.get(db.name) ?? []) notify();
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(`growai:${db.name}:changes`);
    channel.postMessage('changed'); channel.close();
  }
}
export function subscribeSpaceChanges(db: IDBDatabase, notify: () => void): () => void {
  const set = listeners.get(db.name) ?? new Set<() => void>();
  set.add(notify); listeners.set(db.name, set);
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`growai:${db.name}:changes`) : null;
  if (channel) channel.onmessage = () => notify();
  return () => { set.delete(notify); if (!set.size) listeners.delete(db.name); channel?.close(); };
}
/** Bump under the same transaction as business data; notify only after a successful commit. */
export async function advanceWriteRevision(db: IDBDatabase, tx: IDBTransaction) {
  const before = await readTransactionMetadata(tx);
  const next = { ...before, revision: nextEpoch(before.revision ?? '1') };
  const expected = connections.get(db);
  const owned = !!expected && matches(expected, before);
  await read(tx.objectStore('spaceMetadata').put(next));
  tx.addEventListener('complete', () => {
    if (owned && connections.get(db) === expected) connections.set(db, stamp(next));
    notifySpaceChange(db);
  });
}
const read = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('LIFECYCLE_ABORT')); });
}
export function nextEpoch(epoch: string): string {
  if (!/^[1-9]\d*$/.test(epoch)) throw new Error('INVALID_EPOCH');
  return (BigInt(epoch) + 1n).toString();
}
export async function readSpaceMetadata(db: IDBDatabase): Promise<SpaceMetadata> {
  return readTransactionMetadata(db.transaction('spaceMetadata'));
}
export async function readTransactionMetadata(tx: IDBTransaction): Promise<SpaceMetadata> {
  return metadataSchema.parse(await read(tx.objectStore('spaceMetadata').get('time')));
}
export async function initializePersonalLifecycle(db: IDBDatabase) {
  // One-time compatibility for the exact Phase 3.3D-2 v7 BLOCKED foundation record.
  if (db.name !== 'growai-pwa') return;
  const tx = db.transaction('spaceMetadata', 'readwrite'); const completion = done(tx);
  try {
    const raw = await read(tx.objectStore('spaceMetadata').get('time'));
    const meta = metadataSchema.parse(raw);
    if (Object.keys(raw).every(key => ['id', 'databaseInstanceId', 'epoch', 'state'].includes(key))
      && meta.protocolVersion === undefined && meta.state === 'BLOCKED' && meta.mutationOwner === null) {
      await read(tx.objectStore('spaceMetadata').put({ ...meta, protocolVersion: 1, state: 'READY', source: 'personal' }));
    }
    await completion;
  } catch (error) { try { tx.abort(); } catch {} await completion.catch(() => undefined); throw error; }
}

// Per-reset object with private identity; no ambient/global mutable token and no user-supplied permit.
const permitIssuer = Symbol('reset-permit-issuer');
class ResetPermit {
  #db: IDBDatabase; #instance: string; #epoch: string; #owner: string; #token: string;
  constructor(issuer: symbol, db: IDBDatabase, meta: SpaceMetadata) {
    if (issuer !== permitIssuer) throw new Error('INVALID_PERMIT_ISSUER');
    this.#db = db; this.#instance = meta.databaseInstanceId; this.#epoch = meta.epoch; this.#owner = meta.mutationOwner!; this.#token = meta.resetToken!;
    Object.freeze(this);
  }
  assert(db: IDBDatabase, meta: SpaceMetadata) {
    if (db !== this.#db || meta.state !== 'RESETTING' || meta.databaseInstanceId !== this.#instance
      || meta.epoch !== this.#epoch || meta.mutationOwner !== this.#owner || meta.resetToken !== this.#token) throw new Error('STALE_RESET_PERMIT');
  }
}
Object.freeze(ResetPermit.prototype);
export type SeedPermit = ResetPermit;
export async function beginBusinessWrite(db: IDBDatabase, stores: string[], permit?: SeedPermit): Promise<IDBTransaction> {
  const tx = db.transaction([...new Set([...stores, 'spaceMetadata'])], 'readwrite');
  try {
    const meta = metadataSchema.parse(await read(tx.objectStore('spaceMetadata').get('time')));
    if (permit !== undefined) {
      if (!(permit instanceof ResetPermit) || stores.some(name => ['scheduleEvents', 'courses', 'timeOperations'].includes(name))) throw new Error('INVALID_SEED_PERMIT');
      permit.assert(db, meta);
    } else {
      if (meta.state !== 'READY' || meta.mutationOwner !== null || meta.resetToken !== null) throw new Error('SPACE_NOT_READY');
      const expected = connections.get(db);
      if (!expected || !matches(expected, meta)) throw new Error('STALE_DATA_CONNECTION: 数据已在其他页面变化，请重新读取');
      await advanceWriteRevision(db, tx);
    }
    return tx;
  } catch (error) { try { tx.abort(); } catch {} throw error; }
}
export async function beginDemoReset(db: IDBDatabase, expected?: SpaceMetadata): Promise<SeedPermit> {
  if (db.name !== 'growai-pwa-demo') throw new Error('RESET_PERSONAL_FORBIDDEN');
  const tx = db.transaction([...BUSINESS_STORES, 'demoMetadata', 'spaceMetadata', 'timeOperations'], 'readwrite');
  const completion = done(tx);
  try {
    const before = metadataSchema.parse(await read(tx.objectStore('spaceMetadata').get('time')));
    if (expected && (before.databaseInstanceId !== expected.databaseInstanceId || before.epoch !== expected.epoch
      || before.state !== expected.state || before.source !== expected.source
      || before.mutationOwner !== expected.mutationOwner || before.resetToken !== expected.resetToken)) throw new Error('LIFECYCLE_CHANGED');
    const meta: SpaceMetadata = { ...before, epoch: nextEpoch(before.epoch), state: 'RESETTING',
      mutationOwner: createId('reset_owner'), resetToken: createId('reset_token'), source: 'demo-seed', protocolVersion: 1 };
    await read(tx.objectStore('spaceMetadata').put(meta));
    for (const name of [...BUSINESS_STORES, 'demoMetadata']) tx.objectStore(name).clear();
    await completion; return new ResetPermit(permitIssuer, db, meta);
  } catch (error) { try { tx.abort(); } catch {} await completion.catch(() => undefined); throw error; }
}
export async function finishDemoReset(db: IDBDatabase, permit: SeedPermit, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_SEED_DATE');
  if (db.name !== 'growai-pwa-demo' || !(permit instanceof ResetPermit)) throw new Error('INVALID_SEED_PERMIT');
  const tx = db.transaction([...BUSINESS_STORES, 'demoMetadata', 'spaceMetadata'], 'readwrite'); const completion = done(tx);
  try {
    const meta = metadataSchema.parse(await read(tx.objectStore('spaceMetadata').get('time'))); permit.assert(db, meta);
    const all = Object.fromEntries(await Promise.all(BUSINESS_STORES.map(async name => [name, await read(tx.objectStore(name).getAll())]))) as Record<string, Record<string, unknown>[]>;
    const tasks = all.tasks as any[]; const executions = all.taskExecutions as any[]; const achievements = all.achievements as any[];
    if (all.journeys.length !== 1 || all.periods.length !== 1 || all.goals.length !== 3 || all.periodGoals.length !== 3
      || all.weeklyGoals.length !== 3 || tasks.length !== 5 || tasks.filter(t => t.status === 'DONE').length !== 2
      || executions.length !== 2 || achievements.length !== 2 || all.memories.length !== 1
      || all.scheduleEvents.length || all.courses.length || all.conversations.length
      || tasks.some(t => t.periodId !== all.periods[0].id)
      || executions.some(e => !tasks.some(t => t.id === e.taskId && t.status === 'DONE'))
      || achievements.some(a => !tasks.some(t => t.id === a.sourceId && t.status === 'DONE'))) throw new Error('INCOMPLETE_DEMO_SEED');
    if (all.periods[0].journeyId !== all.journeys[0].id || all.journeys[0].currentPeriodId !== all.periods[0].id
      || all.goals.some(g => g.journeyId !== all.journeys[0].id)
      || all.periodGoals.some(g => g.periodId !== all.periods[0].id || !all.goals.some(parent => parent.id === g.longTermGoalId))
      || all.weeklyGoals.some(g => g.periodId !== all.periods[0].id || !all.periodGoals.some(parent => parent.id === g.periodGoalId))
      || tasks.filter(t => t.status === 'DONE').some(t => executions.filter(e => e.taskId === t.id).length !== 1
        || achievements.filter(a => a.sourceId === t.id).length !== 1)
      || all.memories.some(m => m.journeyId !== all.journeys[0].id)) throw new Error('INVALID_DEMO_SEED_RELATIONSHIPS');
    await read(tx.objectStore('demoMetadata').put({ id: 'seed', version: 1, date: todayIso(now), source: 'demo-seed' }));
    await read(tx.objectStore('spaceMetadata').put({ ...meta, state: 'READY', mutationOwner: null, resetToken: null }));
    await completion;
    await bindBusinessConnection(db, true); notifySpaceChange(db);
  } catch (error) { try { tx.abort(); } catch {} await completion.catch(() => undefined); throw error; }
}
export async function markSnapshotImported(tx: IDBTransaction) {
  const meta = metadataSchema.parse(await read(tx.objectStore('spaceMetadata').get('time')));
  if (meta.state !== 'READY' || meta.mutationOwner !== null || meta.resetToken !== null) throw new Error('SPACE_NOT_READY');
  await read(tx.objectStore('spaceMetadata').put({ ...meta, protocolVersion: 1, epoch: nextEpoch(meta.epoch), source: 'imported' }));
  if (tx.objectStoreNames.contains('demoMetadata')) await read(tx.objectStore('demoMetadata').put({ id: 'seed', version: 1, source: 'imported' }));
}

export async function invalidatePendingOperations(tx: IDBTransaction) {
  const meta = metadataSchema.parse(await read(tx.objectStore('spaceMetadata').get('time')));
  if (meta.state !== 'READY' || meta.mutationOwner !== null || meta.resetToken !== null) throw new Error('SPACE_NOT_READY');
  const next = { ...meta, epoch: nextEpoch(meta.epoch) };
  await read(tx.objectStore('spaceMetadata').put(next));
  // Additive seed/week corrections keep the initiating connection usable; peers stay stale.
  // Snapshot replacement/clear deliberately do not take this path.
  tx.addEventListener('complete', () => {
    const current = connections.get(tx.db);
    if (current?.databaseInstanceId === meta.databaseInstanceId && current.epoch === meta.epoch)
      connections.set(tx.db, stamp(next));
  });
}
