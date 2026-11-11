import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { TimeReplanService, type TimeMoveResult } from '@/application/replan/TimeReplanService';
import type { Period } from '@/domain/periods/types';
import type { Task } from '@/domain/tasks/types';
import type { TimeScheduleProposal } from '@/domain/replan/timeAgent';
import type { TimeOperationReference } from '@/application/replan/TimeOperationAdapter';
import { TimeReplanBackendClient } from '@/infrastructure/ai/TimeReplanBackendClient';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { ChoiceChip } from '@/presentation/components/ChoiceChip';
import { Field } from '@/presentation/components/Field';
import { Notice } from '@/presentation/components/Notice';
import { ScreenSection } from '@/presentation/components/Screen';

export function TaskScheduleAgentPanel({ period, store, weekStart, weekEnd, tasks, onScheduled }: {
  period: Period;
  store: GrowthStore;
  weekStart: string;
  weekEnd: string;
  tasks: Task[];
  onScheduled: () => void;
}) {
  const service = useMemo(() => new TimeReplanService(store, new TimeReplanBackendClient()), [store]);
  const schedulable = tasks.filter((task) => (task.status === 'TODO' || task.status === 'DELAYED')
    && task.estimatedMinutes !== null && task.estimatedMinutes > 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<TimeScheduleProposal | null>(null);
  const [operation, setOperation] = useState<TimeOperationReference | null>(null);
  const [result, setResult] = useState<TimeMoveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const schedulableKey = schedulable.map((task) => task.id).join('|');

  useEffect(() => {
    setSelectedId(schedulable[0]?.id ?? null);
    setProposal(null); setOperation(null); setResult(null); setError(null);
  // Reset when the visible week or the set of schedulable Tasks changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, weekEnd, schedulableKey]);

  async function propose() {
    if (!selectedId) return;
    setBusy(true); setError(null); setResult(null); setProposal(null); setOperation(null);
    try {
      const next = await service.proposeSchedule(selectedId, message, { startDate: weekStart, endDate: weekEnd });
      setProposal(next.proposal); setOperation(next.operation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成安排建议失败');
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!proposal || !operation || !service.canConfirm) return;
    setBusy(true); setError(null);
    try {
      const outcome = await service.confirmSchedule(operation, { startDate: weekStart, endDate: weekEnd });
      setResult(outcome);
      if (outcome.status === 'SCHEDULED') {
        setProposal(null);
        onScheduled();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '执行安排失败');
    } finally { setBusy(false); }
  }

  return <ScreenSection>
    <AppText variant="heading">让 AI 安排未排任务</AppText>
    <AppText variant="caption" muted>
      AI 只从所选周空档中建议安排，时长必须等于任务预计时长。建议不代表已经执行。
    </AppText>
    {schedulable.length === 0 ? <AppText muted>没有可安排的任务。需要任务未完成、已填写预计时长，且本周还没有时间块。</AppText> : <>
      <AppText variant="label">1 · 选择任务</AppText>
      <View style={styles.chips}>
        {schedulable.map((task) => <ChoiceChip key={task.id}
          label={`${task.title} · ${task.estimatedMinutes} 分钟`}
          selected={selectedId === task.id}
          onPress={() => { setSelectedId(task.id); setProposal(null); setResult(null); setError(null); }} />)}
      </View>
      <Field label="2 · 时间偏好或限制" value={message} onChangeText={setMessage}
        placeholder="例如：安排在晚上，尽量避开周三；这周下午比较忙" maxLength={2000} multiline editable={!busy} />
      <Button label="生成安排建议" loading={busy} disabled={busy || !selectedId || !message.trim()} onPress={() => void propose()} />
      {error ? <Notice title="安排未生效">{error}</Notice> : null}
      {proposal ? <View style={styles.proposal}>
        <AppText variant="label">3 · 安排建议（未授权执行）</AppText>
        <AppText>{proposal.after.date} {proposal.after.startTime}–{proposal.after.endTime}</AppText>
        <AppText variant="caption" muted>理由：{proposal.reason}</AppText>
        <AppText variant="caption" muted>你可以在计划页手动安排。</AppText>
        {service.canConfirm && operation ? <Button label="确认安排" loading={busy} disabled={busy} onPress={() => void confirm()} /> : null}
        <Button label="取消" variant="quiet" disabled={busy} onPress={() => setProposal(null)} />
      </View> : null}
      {result ? <Notice title={result.status === 'SCHEDULED' ? '安排完成' : result.status === 'REJECTED' ? '安排被拒绝' : result.status === 'NEEDS_RECONCILIATION' ? '安排结果需要核验，请勿重试' : '安排失败'}>
        {result.message}{result.after ? `（${result.after.date} ${result.after.startTime}–${result.after.endTime}）` : ''}
      </Notice> : null}
    </>}
    <AppText variant="caption" muted>当前阶段：{period.startDate} — {period.endDate}。本周起点：{weekStart}。</AppText>
  </ScreenSection>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  proposal: { gap: 8, paddingVertical: 4 },
});
