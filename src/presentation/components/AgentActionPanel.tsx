import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { AgentActionService, type ActionResult } from '@/application/agent/AgentActionService';
import type { AgentAction, AgentActionProposal } from '@/domain/agent/actions';
import { AgentBackendClient } from '@/infrastructure/ai/AgentBackendClient';
import { useGrowthStore } from '@/infrastructure/data/DataContext';
import { todayIso } from '@/shared/date';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { useTheme } from '../theme/tokens';

export function AgentActionCard({ action, taskTitle, result, disabled, onConfirm, onReject }: {
  action: AgentAction; result?: ActionResult; disabled: boolean;
  taskTitle?: string;
  onConfirm: () => void; onReject: () => void;
}) {
  const terminal = result && result.status !== 'PROPOSED';
  return (
    <View style={styles.card}>
      <AppText variant="label">{action.toolName === 'create_task' ? '创建任务' : '修改任务'}</AppText>
      {action.toolName === 'create_task' ? (
        <View>
          <AppText>{action.arguments.title}</AppText>
          <AppText variant="caption">{action.arguments.estimatedMinutes === undefined ? '时长未指定' : `${action.arguments.estimatedMinutes} 分钟`}</AppText>
          {action.arguments.plannedDate ? <AppText variant="caption">日期：{action.arguments.plannedDate}</AppText> : null}
          {action.arguments.description ? <AppText variant="caption">{action.arguments.description}</AppText> : null}
        </View>
      ) : (
        <View>
          <AppText variant="caption">目标任务：{taskTitle ?? action.arguments.taskId}</AppText>
          {action.arguments.changes.title !== undefined ? <AppText>名称：{action.arguments.changes.title}</AppText> : null}
          {action.arguments.changes.estimatedMinutes !== undefined ? <AppText>时长：{action.arguments.changes.estimatedMinutes} 分钟</AppText> : null}
          {action.arguments.changes.plannedDate !== undefined ? <AppText>日期：{action.arguments.changes.plannedDate}</AppText> : null}
          {action.arguments.changes.description !== undefined ? <AppText>说明：{action.arguments.changes.description}</AppText> : null}
        </View>
      )}
      <AppText variant="caption">原因：{action.reason}</AppText>
      {terminal ? <AppText>{result.status === 'EXECUTED' ? `已写入本地数据库：${result.task?.title}`
        : result.status === 'REJECTED' ? '已取消，未修改数据'
          : result.status === 'FAILED' ? `执行失败：${result.error}` : '正在确认并执行…'}</AppText> : (
        <View style={styles.buttons}>
          <Button label="确认执行" disabled={disabled} onPress={onConfirm} />
          <Button label="取消" disabled={disabled} onPress={onReject} />
        </View>
      )}
    </View>
  );
}

export function AgentActionPanel({ journeyId }: { journeyId: string | null }) {
  const theme = useTheme();
  const store = useGrowthStore();
  const service = useMemo(() => new AgentActionService(store, new AgentBackendClient()), [store]);
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<AgentActionProposal | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    if (!journeyId) return;
    setBusy(true); setError(null);
    try {
      const next = await service.propose({ journeyId, date: todayIso() }, message);
      setProposal(next); setResults({});
    } catch (caught) { setError(caught instanceof Error ? caught.message : '生成建议失败'); }
    finally { setBusy(false); }
  }

  async function confirm(id: string) {
    setBusy(true); setError(null);
    try {
      const result = await service.executeApprovedAction(id, true);
      setResults((current) => ({ ...current, [id]: result }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : '执行失败'); }
    finally { setBusy(false); }
  }

  function reject(id: string) {
    try {
      const result = service.rejectAction(id);
      setResults((current) => ({ ...current, [id]: result }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : '取消失败'); }
  }

  return (
    <View style={styles.wrap}>
      <TextInput accessibilityLabel="任务调整需求" placeholder="例如：帮我创建一个 Python 学习任务"
        value={message} onChangeText={setMessage} editable={!busy} multiline maxLength={2000}
        style={[styles.input, { color: theme.text, borderColor: theme.border }]} />
      <Button label="生成操作建议" disabled={!journeyId || !message.trim()} loading={busy} onPress={() => void propose()} />
      {error ? <Notice title="Agent 操作失败">{error}</Notice> : null}
      {proposal ? <AppText>{proposal.message}</AppText> : null}
      {proposal?.actions.map((action) => <AgentActionCard key={action.id} action={action}
        result={results[action.id]} disabled={busy}
        onConfirm={() => void confirm(action.id)} onReject={() => reject(action.id)} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 }, input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 70 },
  card: { padding: 12, gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  buttons: { flexDirection: 'row', gap: 10 },
});
