import { reflectionSchema } from '@/domain/reflection/types';
import { exclusiveWrite } from '../exclusiveWrite';
import { conversationSchema, type ConversationScope, type ConversationRepository } from '@/domain/agent/conversation';
import type { DatabaseLike } from '../types';
import { createId } from '@/shared/id';
export function createSQLiteConversationRepository(db: DatabaseLike): ConversationRepository {
  async function assertScope(scope: ConversationScope, reader = db) {
    const period = await reader.getFirstAsync<{ journey_id: string }>('SELECT journey_id FROM period WHERE id = ?', scope.periodId);
    if (period?.journey_id !== scope.journeyId) throw new Error('会话作用域不匹配');
  }
  return {
    savesReflectionOnAppend: true,
    async list(scope) {
      await assertScope(scope);
      return (await db.getAllAsync<{ record_json: string }>('SELECT record_json FROM agent_conversation WHERE journey_id = ? AND period_id = ?', scope.journeyId, scope.periodId))
        .map(row => conversationSchema.parse(JSON.parse(row.record_json)))
        .filter(row => row.scope.journeyId === scope.journeyId && row.scope.periodId === scope.periodId)
        .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async create(scope) {
      await assertScope(scope);
      const now = new Date().toISOString();
      const record = conversationSchema.parse({ id: createId('conversation'), scope, epoch: 'native-local', createdAt: now, updatedAt: now, messages: [] });
      const result = await db.runAsync('INSERT INTO agent_conversation(id,journey_id,period_id,record_json) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM period WHERE id = ? AND journey_id = ?)',
        record.id, scope.journeyId, scope.periodId, JSON.stringify(record), scope.periodId, scope.journeyId) as { changes: number };
      if (result.changes !== 1) throw new Error('会话创建未确认');
      return record;
    },
    async append(scope, id, message) {
      return exclusiveWrite(db, async tx => {
      await assertScope(scope, tx);
      const row = await tx.getFirstAsync<{ record_json: string }>('SELECT record_json FROM agent_conversation WHERE id = ? AND journey_id = ? AND period_id = ?', id, scope.journeyId, scope.periodId);
      if (!row) throw new Error('会话不存在，请重新读取');
      const before = conversationSchema.parse(JSON.parse(row.record_json));
      if (before.scope.journeyId !== scope.journeyId || before.scope.periodId !== scope.periodId) throw new Error('会话内容作用域不匹配');
      if (before.messages.some(item => item.id === message.id)) return before;
      if (message.reflection && message.status === 'complete' && message.requestId) {
        const reflection = reflectionSchema.parse(message.reflection);
        if (reflection.journeyId !== scope.journeyId || reflection.periodId !== scope.periodId) throw new Error('复盘作用域不匹配');
        const existing = await tx.getFirstAsync<{ record_json: string }>('SELECT record_json FROM reflection WHERE id = ?', reflection.id);
        if (existing) {
          const saved = reflectionSchema.parse(JSON.parse(existing.record_json));
          if (saved.journeyId !== scope.journeyId || saved.periodId !== scope.periodId) throw new Error('复盘记录作用域不匹配');
          message = { ...message, reflection: saved };
        } else {
          await tx.runAsync('INSERT INTO reflection (id, journey_id, period_id, record_json) VALUES (?, ?, ?, ?)',
            reflection.id, reflection.journeyId, reflection.periodId, JSON.stringify(reflection));
        }
      }
      const record = conversationSchema.parse({ ...before, messages: [...before.messages, message], updatedAt: new Date().toISOString() });
      const result = await tx.runAsync('UPDATE agent_conversation SET record_json = ? WHERE id = ? AND record_json = ? AND EXISTS (SELECT 1 FROM period WHERE id = ? AND journey_id = ?)',
        JSON.stringify(record), id, row.record_json, scope.periodId, scope.journeyId) as { changes: number };
      if (result.changes !== 1) throw new Error('会话被其他请求修改，未覆盖，请重新读取');
      return record;
      });
    },
    async clear(scope) { await assertScope(scope); await db.runAsync('DELETE FROM agent_conversation WHERE journey_id = ? AND period_id = ?', scope.journeyId, scope.periodId); },
  };
}
