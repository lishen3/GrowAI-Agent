import type { GrowthStore } from '@/application/data/GrowthStore';
import { ConversationService } from '@/application/agent/ConversationService';
import type { ConversationMessage, ConversationScope } from '@/domain/agent/conversation';
import type { Reflection } from '@/domain/reflection/types';
import { createId } from '@/shared/id';
import { hasDuplicateMemoryCandidate } from './WeeklyReflectionService';
import { ReflectionGenerationFailure } from './ReflectionGenerationFailure';

type RequestState = { requestId: string; conversationId: string; status: 'pending' | 'complete' | 'failed'; messageId?: string; error?: string };

type RequestScopes = Map<string, ReturnType<typeof createRequests>>;
const requests = new WeakMap<GrowthStore, RequestScopes>();

// Retain request state across revisions, with a writer bound by the provider to this database and epoch.
export function bindReflectionStore(store: GrowthStore, scopes: RequestScopes) {
  requests.set(store, scopes);
  for (const manager of scopes.values()) manager.bind(store);
  return () => { for (const manager of scopes.values()) manager.detach(store); };
}

function createRequests(initial: GrowthStore, scope: ConversationScope) {
  const savesOnAppend = initial.conversations?.savesReflectionOnAppend;
  let writer: GrowthStore | null = initial;
  let state: RequestState | null = null;
  let delivery: { conversationId: string; requestId: string; message: ConversationMessage; checkMemory: boolean } | null = null;
  let saving = false;
  const listeners = new Set<() => void>();
  const publish = (next: RequestState) => { state = next; listeners.forEach(listener => listener()); };
  async function deliver(): Promise<void> {
    if (!writer || !delivery || saving) return;
    const store = writer;
    const { conversationId, requestId, checkMemory } = delivery;
    let { message } = delivery;
    saving = true;
    try {
      if (checkMemory && message.reflection && !await store.getReflection(scope.journeyId, message.reflection.id)
        && await hasDuplicateMemoryCandidate(store, scope.journeyId, message.reflection)) {
        message = { id: createId('message'), role: 'agent', requestId, status: 'failed', reflectionRecovery: 'failed', text: '复盘记忆候选与已有记忆重复，未保存。' };
      }
      await new ConversationService(store).append(scope, conversationId, message);
      delivery = null;
      publish({ conversationId, requestId, messageId: message.id, status: message.status === 'failed' ? 'failed' : 'complete' });
    } catch (error) {
      if (store === writer) publish({ conversationId, requestId, status: 'failed', error: '本地对话保存未确认，请重新读取复盘记录：' + (error instanceof Error ? error.message : '存储失败') });
    } finally {
      saving = false;
    }
    if (delivery && writer && writer !== store) await deliver();
  }
  return {
    bind(store: GrowthStore) {
      writer = store;
      if (delivery) {
        publish({ conversationId: delivery.conversationId, requestId: delivery.requestId, status: 'pending' });
        void deliver();
      }
    },
    detach(store: GrowthStore) { if (writer === store) writer = null; },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start(conversationId: string, requestId: string, work: () => Promise<{ reflection: Reflection; history: boolean; recovered?: boolean }>) {
      if (!writer || saving || state?.status === 'pending') return null;
      publish({ conversationId, requestId, status: 'pending' });
      return (async () => {
        let message: ConversationMessage;
        let checkMemory = false;
        try {
          const result = await work();
          checkMemory = !!savesOnAppend && !result.history && !!result.reflection.memoryCandidates?.length;
          message = { id: 'reflection_complete_' + requestId, role: 'agent', status: 'complete', requestId,
            text: result.recovered ? '原复盘结果已恢复并保存，没有重新生成。' : result.history ? '查看本周历史复盘，未重新调用模型。' : '本周复盘已生成并保存。', reflection: result.reflection };
        } catch (error) {
          message = { id: createId('message'), role: 'agent', status: 'failed', requestId,
            reflectionRecovery: error instanceof ReflectionGenerationFailure ? error.reflectionRecovery : 'unknown',
            text: error instanceof ReflectionGenerationFailure
              ? `${error.message}。\n${error.factualSummary}`
              : '未完成：' + (error instanceof Error ? error.message : '请求失败') + '。未自动重试，未执行排程。' };
        }
        delivery = { conversationId, requestId, message, checkMemory };
        await deliver();
      })();
    },
  };
}

export function backgroundReflection(store: GrowthStore, scope: ConversationScope) {
  let scopes = requests.get(store);
  if (!scopes) { scopes = new Map(); requests.set(store, scopes); }
  const key = JSON.stringify([scope.journeyId, scope.periodId]);
  let manager = scopes.get(key);
  if (!manager) { manager = createRequests(store, { ...scope }); scopes.set(key, manager); }
  return manager;
}
