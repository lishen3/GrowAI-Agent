import type { GrowthStore } from '@/application/data/GrowthStore';
import { conversationMessageSchema, conversationScopeSchema, type ConversationScope, type ConversationMessage } from '@/domain/agent/conversation';
export class ConversationService {
  constructor(private readonly store: GrowthStore) {}
  private async repository(scope: ConversationScope) {
    conversationScopeSchema.parse(scope);
    const journey = await this.store.getJourney();
    if (journey?.id !== scope.journeyId || !(await this.store.listPeriods(journey.id)).some(p => p.id === scope.periodId)) throw new Error('会话不属于当前旅程和阶段');
    if (!this.store.conversations) throw new Error('当前数据源尚不支持会话存储');
    return this.store.conversations;
  }
  async list(scope: ConversationScope) { return (await this.repository(scope)).list(scope); }
  async create(scope: ConversationScope) { return (await this.repository(scope)).create(scope); }
  async append(scope: ConversationScope, id: string, message: ConversationMessage) {
    return (await this.repository(scope)).append(scope, id, conversationMessageSchema.parse(message));
  }
  async clear(scope: ConversationScope) { return (await this.repository(scope)).clear(scope); }
}
