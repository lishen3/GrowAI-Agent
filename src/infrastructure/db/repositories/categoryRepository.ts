import { categorySchema, defaultCategories, normalizeCategoryName, type ActionCategory, type CategoryRepository } from '@/domain/categories/types';
import type { DatabaseLike } from '../types';
import { createId } from '@/shared/id';

export const categoryRegistrySQL = `CREATE TABLE action_category (
  journey_id TEXT NOT NULL REFERENCES growth_journey(id),
  id TEXT NOT NULL, normalized_name TEXT NOT NULL, record_json TEXT NOT NULL,
  PRIMARY KEY(journey_id,id), UNIQUE(journey_id,normalized_name)
);`;
type Handle = Pick<DatabaseLike, 'getFirstAsync' | 'getAllAsync' | 'runAsync'>;
export async function requireNativeCategory(db: Pick<Handle, 'getFirstAsync'>, periodId: string, id: string, allowArchived = false) {
  const period = await db.getFirstAsync<{ journey_id: string }>('SELECT journey_id FROM period WHERE id = ?', periodId);
  if (!period) throw new Error('分类阶段不存在');
  const saved = await db.getFirstAsync<{ record_json: string }>('SELECT record_json FROM action_category WHERE journey_id = ? AND id = ?',period.journey_id,id);
  const row = saved ? categorySchema.parse(JSON.parse(saved.record_json)) : defaultCategories(period.journey_id).find(row => row.id === id);
  if (!row || row.journeyId !== period.journey_id || (!allowArchived && row.status !== 'ACTIVE')) throw new Error('分类不存在、已归档或不属于当前旅程');
  return row;
}
type Exclusive = { withExclusiveTransactionAsync?: (work: (tx: Handle) => Promise<void>) => Promise<void> };
/** No ordinary transaction fallback: every read/write uses the supplied exclusive handle. */
export function createSQLiteCategoryRepository(db: DatabaseLike & Exclusive): CategoryRepository {
  const listeners = new Set<() => void>();
  async function rows(handle: Handle, journeyId: string) {
    if (!await handle.getFirstAsync('SELECT id FROM growth_journey WHERE id = ?', journeyId)) throw new Error('分类旅程不存在');
    const saved = (await handle.getAllAsync<{ record_json: string }>('SELECT record_json FROM action_category WHERE journey_id = ?', journeyId))
      .map(row => categorySchema.parse(JSON.parse(row.record_json)));
    if (saved.some(row => row.journeyId !== journeyId)) throw new Error('分类作用域错误');
    return [...new Map([...defaultCategories(journeyId), ...saved].map(row => [row.id,row])).values()];
  }
  async function write(journeyId: string, build: (existing: ActionCategory[]) => ActionCategory) {
    if (!db.withExclusiveTransactionAsync) throw new Error('独立分类事务不可用');
    let result!: ActionCategory;
    await db.withExclusiveTransactionAsync(async tx => {
      const existing = await rows(tx,journeyId);
      result = categorySchema.parse(build(existing));
      if (existing.some(row => row.id !== result.id && row.normalizedName === result.normalizedName)) throw new Error('分类名称已存在（包括已归档分类）');
      await tx.runAsync('INSERT INTO action_category(journey_id,id,normalized_name,record_json) VALUES (?,?,?,?) ON CONFLICT(journey_id,id) DO UPDATE SET normalized_name=excluded.normalized_name, record_json=excluded.record_json',
        journeyId,result.id,result.normalizedName,JSON.stringify(result));
    });
    for (const listener of listeners) listener();
    return result;
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async list(journeyId) { return (await rows(db,journeyId)).sort((a,b) => a.sortOrder - b.sortOrder); },
    create(journeyId,name) { return write(journeyId,existing => {
      const now = new Date().toISOString();
      return { id: createId('category'), journeyId, name: name.trim(), normalizedName: normalizeCategoryName(name),
        system: false, status: 'ACTIVE', sortOrder: Math.max(0,...existing.map(row => row.sortOrder)) + 1, createdAt: now, updatedAt: now };
    }); },
    update(journeyId,id,changes) { return write(journeyId,existing => {
      const before = existing.find(row => row.id === id);
      if (!before) throw new Error('分类不存在');
      if (before.system) throw new Error('系统分类不可重命名或归档');
      return { ...before,...changes,name: changes.name?.trim() ?? before.name,
        normalizedName: changes.name === undefined ? before.normalizedName : normalizeCategoryName(changes.name), updatedAt: new Date().toISOString() };
    }); },
  };
}
