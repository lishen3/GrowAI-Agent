import type { MemoryGateway } from '@/application/memory/MemoryApplicationService';
import type { ReflectionStore } from '@/application/reflection/WeeklyReflectionService';
import { createMemorySchema, normalizeMemoryContent, type Memory } from '@/domain/memory/types';
import { reflectionSchema, type Reflection } from '@/domain/reflection/types';
import { createId } from '@/shared/id';
import type { DatabaseLike } from '../types';

type RecordRow = { record_json: string };

export function createSQLiteMemoryRepository(db: DatabaseLike): MemoryGateway & ReflectionStore {
  return {
    async createMemory(input) {
      const value = createMemorySchema.parse(input);
      let result: Memory | undefined;
      await db.withTransactionAsync(async () => {
        const journey = await db.getFirstAsync('SELECT id FROM growth_journey WHERE id = ?', value.journeyId);
        if (!journey) throw new Error('成长旅程不存在');
        if (value.sourceType === 'REFLECTION') {
          const source = await db.getFirstAsync('SELECT id FROM reflection WHERE id = ? AND journey_id = ?', value.sourceId, value.journeyId);
          if (!source) throw new Error('复盘来源不存在');
        }
        const normalized = normalizeMemoryContent(value.content);
        const now = new Date().toISOString();
        const memory: Memory = { ...value, id: createId('memory'), status: 'ACTIVE', createdAt: now, updatedAt: now };
        await db.runAsync(`INSERT INTO memory (id, journey_id, type, normalized_content, record_json)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(journey_id, type, normalized_content) DO NOTHING`,
        memory.id, value.journeyId, value.type, normalized, JSON.stringify(memory));
        const row = await db.getFirstAsync<RecordRow>(
          'SELECT record_json FROM memory WHERE journey_id = ? AND type = ? AND normalized_content = ?',
          value.journeyId, value.type, normalized);
        result = JSON.parse(row!.record_json) as Memory;
      });
      return result!;
    },
    async listMemories(journeyId) {
      const rows = await db.getAllAsync<RecordRow>('SELECT record_json FROM memory WHERE journey_id = ?', journeyId);
      return rows.map((row) => JSON.parse(row.record_json) as Memory);
    },
    async archiveMemory(journeyId, memoryId) {
      let result: Memory | undefined;
      await db.withTransactionAsync(async () => {
        const row = await db.getFirstAsync<RecordRow>('SELECT record_json FROM memory WHERE id = ? AND journey_id = ?', memoryId, journeyId);
        if (!row) throw new Error('记忆不存在');
        result = JSON.parse(row.record_json) as Memory;
        if (result.status === 'ARCHIVED') return;
        result = { ...result, status: 'ARCHIVED', updatedAt: new Date().toISOString() };
        await db.runAsync('UPDATE memory SET record_json = ? WHERE id = ? AND journey_id = ?', JSON.stringify(result), memoryId, journeyId);
      });
      return result!;
    },
    async saveReflection(input) {
      const value = reflectionSchema.parse(input);
      const period = await db.getFirstAsync('SELECT id FROM period WHERE id = ? AND journey_id = ?', value.periodId, value.journeyId);
      if (!period) throw new Error('复盘阶段不属于成长旅程');
      await db.runAsync('INSERT INTO reflection (id, journey_id, period_id, record_json) VALUES (?, ?, ?, ?)',
        value.id, value.journeyId, value.periodId, JSON.stringify(value));
    },
    async getReflection(journeyId, reflectionId) {
      const row = await db.getFirstAsync<RecordRow>('SELECT record_json FROM reflection WHERE id = ? AND journey_id = ?', reflectionId, journeyId);
      return row ? JSON.parse(row.record_json) as Reflection : null;
    },
    async listReflections(journeyId) {
      const rows = await db.getAllAsync<RecordRow>('SELECT record_json FROM reflection WHERE journey_id = ?', journeyId);
      return rows.map((row) => JSON.parse(row.record_json) as Reflection)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
