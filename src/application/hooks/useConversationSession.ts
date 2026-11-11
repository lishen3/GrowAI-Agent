import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { ConversationService } from '@/application/agent/ConversationService';
import type { Conversation, ConversationMessage } from '@/domain/agent/conversation';
import { createId } from '@/shared/id';
export function useConversationSession(store: GrowthStore, journeyId: string | null, periodId: string | null) {
  const scope = useMemo(() => ({ journeyId: journeyId ?? '', periodId: periodId ?? '' }), [store, journeyId, periodId]);
  const service = useMemo(() => new ConversationService(store), [store]);
  const [state, setState] = useState<{ scope: typeof scope; conversation: Conversation | null; history: Conversation[]; loading: boolean; error: string | null }>({
    scope, conversation: null, history: [], loading: true, error: null,
  });
  const revision = useRef(0);
  const session = useRef<Conversation | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const active = useRef(false);
  const currentScope = useRef(scope); currentScope.current = scope;
  const failed = useRef(false);
  const load = useCallback(async () => {
    const token = ++revision.current;
    active.current = true; failed.current = false;
    setState(previous => ({ ...previous, loading: true, error: null }));
    try {
      await queue.current;
      if (!active.current || token !== revision.current || currentScope.current !== scope) return;
      if (!journeyId || !periodId) throw new Error('请先选择阶段');
      const history = await service.list(scope);
      if (!active.current || token !== revision.current || currentScope.current !== scope) return;
      const previous = session.current;
      const conversation = history.find(row => row.id === previous?.id && row.scope.journeyId === scope.journeyId && row.scope.periodId === scope.periodId && row.epoch === previous.epoch) ?? history[0] ?? await service.create(scope);
      if (active.current && token === revision.current && currentScope.current === scope) {
        session.current = conversation;
        setState({ scope, conversation, history: history.length ? history : [conversation], loading: false, error: null });
      }
    } catch (error) {
      if (token === revision.current && active.current) setState(previous => ({ ...previous, scope, loading: false, error: error instanceof Error ? error.message : '会话读取失败' }));
    }
  }, [scope, service, journeyId, periodId]);
  useFocusEffect(useCallback(() => { void load(); return () => { active.current = false; revision.current++; }; }, [load]));
  function add(message: Omit<ConversationMessage, 'id' | 'status'> & { status?: ConversationMessage['status'] }) {
    const current = session.current;
    if (!active.current || currentScope.current !== scope || !current || current.id !== state.conversation?.id || state.loading || state.error || failed.current) return;
    const row: ConversationMessage = { ...message, id: createId('message'), status: message.status ?? 'info' };
    const token = revision.current;
    const showMessage = () => setState(previous => ({ ...previous, conversation: previous.conversation ? { ...previous.conversation, messages: [...previous.conversation.messages, row] } : null }));
    if (!row.decision) showMessage();
    queue.current = queue.current.then(async () => {
      if (failed.current) return;
      try {
        const saved = await service.append(scope, current.id, row);
        if (active.current && token === revision.current && currentScope.current === scope) {
          session.current = saved;
          if (row.decision) showMessage();
          setState(previous => ({ ...previous, history: [saved, ...previous.history.filter(item => item.id !== saved.id)] }));
        }
      } catch (error) {
        failed.current = true;
        if (active.current && token === revision.current && currentScope.current === scope) setState(previous => ({ ...previous, error: '本地保存未确认，请重新读取，未自动重试：' + (error instanceof Error ? error.message : '存储失败') }));
      }
    });
  }
  async function select(id?: string, clear = false) {
    if (!active.current || currentScope.current !== scope) return;
    const token = ++revision.current; setState(previous => ({ ...previous, loading: true }));
    try {
      await queue.current;
      if (!active.current || token !== revision.current || currentScope.current !== scope) return;
      if (clear) await service.clear(scope);
      const history = await service.list(scope);
      if (!active.current || token !== revision.current || currentScope.current !== scope) return;
      const conversation = id ? history.find(item => item.id === id) : await service.create(scope);
      if (!conversation) throw new Error('会话已删除');
      if (active.current && token === revision.current && currentScope.current === scope) {
        failed.current = false; session.current = conversation;
        setState({ scope, conversation, history: [conversation, ...history.filter(item => item.id !== conversation.id)], loading: false, error: null });
      }
    } catch (error) { if (active.current && token === revision.current && currentScope.current === scope) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : '切换失败' })); }
  }
  const visible = state.scope === scope;
  return { messages: visible ? state.conversation?.messages ?? [] : [], history: visible ? state.history : [],
    id: visible ? state.conversation?.id : undefined, loading: !visible || state.loading,
    epoch: visible ? state.conversation?.epoch : undefined,
    error: visible ? state.error : null, add, reload: load, select,
    flush: async () => { await queue.current; if (failed.current) throw new Error('请求记录保存未确认，未发起模型请求'); },
    newConversation: () => select(), clear: () => select(undefined, true) };
}
