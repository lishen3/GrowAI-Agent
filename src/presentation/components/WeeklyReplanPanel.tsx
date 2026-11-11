import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AgentActionService, type ActionResult } from '@/application/agent/AgentActionService';
import { AgentContextService } from '@/application/agent/AgentContextService';
import { WeeklyReplanService } from '@/application/replan/WeeklyReplanService';
import type { AgentContext } from '@/domain/agent/types';
import type { WeeklyReplanProposal } from '@/domain/replan/types';
import { AgentBackendClient } from '@/infrastructure/ai/AgentBackendClient';
import { ReplanBackendClient } from '@/infrastructure/ai/ReplanBackendClient';
import { useGrowthStore } from '@/infrastructure/data/DataContext';
import { todayIso } from '@/shared/date';
import { AgentActionCard } from './AgentActionPanel';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { useTheme } from '../theme/tokens';

const minutes = (value: number | null) => value === null ? '未知（记录不足）' : `${value} 分钟`;
export function ReplanExplanation({ proposal, context }: { proposal: WeeklyReplanProposal; context?: AgentContext }) {
  return <View style={styles.wrap}>
    <AppText variant="heading">AI 判断 · 待核对的分析</AppText><AppText>{proposal.summary}</AppText>
    {proposal.diagnosis.map((item, index) => <View key={index}><AppText>{item.statement}</AppText><AppText variant="caption" muted>依据：{item.evidence}</AppText></View>)}
    <AppText variant="label">调整策略</AppText>
    {proposal.strategy.map((item, index) => <View key={index}><AppText>{item.statement}</AppText><AppText variant="caption">原因：{item.reason}</AppText>
      <AppText variant="caption" muted>历史记忆依据：{item.basedOnMemoryIds.length ? '' : '无引用'}</AppText>
      {item.basedOnMemoryIds.map((id) => {
        const memory = context?.memories.find((memory) => memory.id === id);
        return <View key={id}>
          <AppText variant="caption">{memory?.content ?? id}</AppText>
          {memory ? <AppText variant="caption" muted>记忆证据：{memory.evidence} · {memory.sourceType === 'USER' ? '用户陈述' : '已保存复盘'}</AppText> : null}
        </View>;
      })}</View>)}
    <AppText variant="label">预计变化 · 尚未执行</AppText>
    <AppText>本周计划时长：{minutes(proposal.expectedChanges.beforePlannedMinutes)} → {minutes(proposal.expectedChanges.afterPlannedMinutes)}</AppText>
    <AppText variant="caption" muted>涉及 {proposal.expectedChanges.affectedTaskCount} 个任务；这是全部建议的预计值，部分确认后的真实结果以读库为准。</AppText>
  </View>;
}

export function WeeklyReplanPanel({ journeyId, onContextReadback }: {
  journeyId: string | null; onContextReadback?: (context: AgentContext) => void;
}) {
  const theme = useTheme(); const store = useGrowthStore();
  const service = useMemo(() => new WeeklyReplanService(new AgentContextService(store),
    new ReplanBackendClient(), new AgentActionService(store, new AgentBackendClient())), [store]);
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<WeeklyReplanProposal | null>(null);
  const [before, setBefore] = useState<AgentContext | null>(null);
  const [actual, setActual] = useState<AgentContext | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : '重排失败'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function confirm(ids: string[]) {
    for (const id of ids) {
      const outcome = await service.confirm(id);
      setResults((old) => ({ ...old, [id]: outcome.result }));
      setSelected((old) => old.filter((item) => item !== id));
      if (outcome.context) { setActual(outcome.context); onContextReadback?.(outcome.context); }
      if (outcome.refreshError) { setActual(null); setError(`任务已执行，但 Context 刷新失败：${outcome.refreshError}`); }
    }
  }
  function reject(ids: string[]) {
    try {
      for (const id of ids) {
        const result = service.reject(id);
        setResults((old) => ({ ...old, [id]: result }));
      }
      setSelected((old) => old.filter((id) => !ids.includes(id)));
    } catch (caught) { setError(String(caught)); }
  }
  const pending = proposal?.actions.filter((action) => !results[action.id]) ?? [];

  return <View style={styles.wrap}>
    <AppText variant="label">1 · 告诉我这周的新情况</AppText>
    <AppText variant="caption" muted>只重排本周未完成计划。用户新情况、历史记忆与执行事实分开使用，不自动改目标或记忆。</AppText>
    <TextInput accessibilityLabel="本周重新规划需求" value={message} onChangeText={setMessage}
      placeholder="最近比赛太忙，英语连续几天没完成，重新安排这周。" multiline maxLength={2000} editable={!busy}
      style={[styles.input, { color: theme.text, borderColor: theme.border }]} />
    <Button label="重新规划本周" disabled={!journeyId || !message.trim()} loading={busy} onPress={() => void run(async () => {
      if (!journeyId) return;
      const next = await service.propose({ journeyId, date: todayIso() }, message);
      setProposal(next.proposal); setBefore(next.context); setActual(null); setResults({});
      onContextReadback?.(next.context);
      setSelected(next.proposal.actions.map((action) => action.id));
    })} />
    <AppText variant="caption" muted>{busy ? '正在处理请求，请等待结果。' : '生成建议不会修改任务。确认后才会执行。'}</AppText>
    {error ? <Notice title="重排提示">{error}</Notice> : null}
    {proposal ? <>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <AppText variant="label">2 · 建议与依据</AppText>
        <ReplanExplanation proposal={proposal} context={before ?? undefined} />
      </View>
      <AppText variant="heading">3 · 待你确认</AppText>
      <AppText variant="caption" muted>可逐项确认、拒绝，或只确认选中项。未确认的操作不会执行。</AppText>
      {proposal.actions.length === 0 ? <AppText muted>没有可执行调整。请查看数据不足或范围限制的说明。</AppText> : null}
      {proposal.actions.map((action) => {
        const previous = action.toolName === 'update_task' ? before?.tasks.find((task) => task.id === action.arguments.taskId) : undefined;
        return <View key={action.id} style={styles.wrap}>
          {!results[action.id] ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(action.id), disabled: busy }} disabled={busy}
            onPress={() => setSelected((old) => old.includes(action.id) ? old.filter((id) => id !== action.id) : [...old, action.id])}>
            <AppText>{selected.includes(action.id) ? '☑ 已选中' : '☐ 未选中'}</AppText>
          </Pressable> : null}
          {previous && action.toolName === 'update_task' ? <AppText variant="caption">{previous.title}：
            {minutes(previous.estimatedMinutes)} → {minutes(action.arguments.changes.estimatedMinutes ?? previous.estimatedMinutes)}；
            {previous.plannedDate} → {action.arguments.changes.plannedDate ?? previous.plannedDate}</AppText> : null}
          <AgentActionCard action={action} taskTitle={previous?.title} result={results[action.id]} disabled={busy}
            onConfirm={() => void run(() => confirm([action.id]))} onReject={() => reject([action.id])} />
        </View>;
      })}
      {pending.length ? <AppText variant="caption">待处理 {pending.length} 项 · 当前选中 {selected.length} 项</AppText> : null}
      <Button label="确认选中的调整" disabled={busy || !selected.length} onPress={() => void run(() => confirm([...selected]))} />
      <Button label="全部取消" variant="quiet" disabled={busy || !pending.length} onPress={() => reject(pending.map((action) => action.id))} />
    </> : null}
    {Object.keys(results).length ? <View style={[styles.card, { backgroundColor: theme.surfaceStrong, borderColor: theme.border }]}>
      <AppText variant="heading">4 · 执行结果</AppText>
      <AppText>已执行 {Object.values(results).filter((result) => result.status === 'EXECUTED').length} 项 · 已拒绝 {Object.values(results).filter((result) => result.status === 'REJECTED').length} 项 · 失败 {Object.values(results).filter((result) => result.status === 'FAILED').length} 项</AppText>
      <AppText variant="caption" muted>拒绝不会修改数据库；失败原因见对应操作卡片。</AppText>
    </View> : null}
    {actual ? <View style={[styles.card, { backgroundColor: theme.primarySoft, borderColor: theme.border }]}>
      <AppText variant="heading">调整后 · 数据库重新读取</AppText>
      <AppText variant="caption" muted>读取时间：{actual.generatedAt}（不是 AI 预测）</AppText>
      <AppText>本周计划时长：{minutes(actual.planVsReality.plannedMinutes)}</AppText>
      <AppText variant="label">未完成任务</AppText>
      {actual.planVsReality.unfinishedTasks.map((task) => <AppText key={task.id} variant="caption">{task.plannedDate} · {task.title} · {minutes(task.estimatedMinutes)}</AppText>)}
      <AppText variant="label">分类计划／实际投入</AppText>
      {actual.planVsReality.categoryBreakdown.map((item) => <AppText key={item.categoryId ?? item.category} variant="caption">{actual.categories?.find(row => row.id === (item.categoryId ?? item.category))?.name ?? item.category}：{minutes(item.plannedMinutes)}／{minutes(item.actualMinutes)}</AppText>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 90 },
});
