import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { TimeReplanService, type TimeMoveResult } from '@/application/replan/TimeReplanService';
import type { Period } from '@/domain/periods/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import type { TimeMoveProposal } from '@/domain/replan/timeAgent';
import type { TimeOperationReference } from '@/application/replan/TimeOperationAdapter';
import { TimeReplanBackendClient } from '@/infrastructure/ai/TimeReplanBackendClient';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { ChoiceChip } from '@/presentation/components/ChoiceChip';
import { Field } from '@/presentation/components/Field';
import { Notice } from '@/presentation/components/Notice';
import { ScreenSection } from '@/presentation/components/Screen';

export function TimeAgentPanel({ period, store, weekStart, weekEnd, events, onMoved }: {
  period: Period;
  store: GrowthStore;
  weekStart: string;
  weekEnd: string;
  events: ScheduleEvent[];
  onMoved: () => void;
}) {
  const service = useMemo(() => new TimeReplanService(store, new TimeReplanBackendClient()), [store]);
  const movable = events.filter((event) => event.type === 'TASK' && event.source === 'USER');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<TimeMoveProposal | null>(null);
  const [operation, setOperation] = useState<TimeOperationReference | null>(null);
  const [result, setResult] = useState<TimeMoveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelectedId(movable[0]?.id ?? null);
    setProposal(null); setOperation(null); setResult(null); setError(null);
  // Reset only when the visible week changes; events are derived from that week.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  async function propose() {
    if (!selectedId) return;
    setBusy(true); setError(null); setResult(null); setProposal(null); setOperation(null);
    try {
      const next = await service.propose(selectedId, message, { startDate: weekStart, endDate: weekEnd });
      setProposal(next.proposal); setOperation(next.operation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成调整建议失败');
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!proposal || !operation || !service.canConfirm) return;
    setBusy(true); setError(null);
    try {
      const outcome = await service.confirm(operation);
      setResult(outcome);
      if (outcome.status === 'MOVED') {
        setProposal(null);
        onMoved();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '执行移动失败');
    } finally { setBusy(false); }
  }

  return <ScreenSection>
    <AppText variant="heading">让 AI 调整时间块</AppText>
    <AppText variant="caption" muted>
      只建议移动一个已有任务时间块，时长不变；课程和临时日程是硬约束。建议不代表已经执行。
    </AppText>
    {movable.length === 0 ? <AppText muted>本周还没有可移动的任务时间块。先把待安排任务放进时间表，再让 AI 调整。</AppText> : <>
      <AppText variant="label">1 · 选择要调整的任务时间块</AppText>
      <View style={styles.chips}>
        {movable.map((event) => <ChoiceChip key={event.id} label={`${event.date} ${event.startTime}-${event.endTime} ${event.title}`}
          selected={selectedId === event.id} onPress={() => { setSelectedId(event.id); setProposal(null); setResult(null); setError(null); }} />)}
      </View>
      <Field label="2 · 告诉 AI 你的限制或偏好" value={message} onChangeText={setMessage}
        placeholder="例如：周三下午要开会，把这个任务挪到周内更安静的时间" maxLength={2000} multiline editable={!busy} />
      <Button label="生成调整建议" loading={busy} disabled={busy || !selectedId || !message.trim()} onPress={() => void propose()} />
      {error ? <Notice title="调整未生效">{error}</Notice> : null}
      {proposal ? <View style={styles.proposal}>
        <AppText variant="label">3 · 移动建议（未授权执行）</AppText>
        <AppText>{proposal.before.date} {proposal.before.startTime}–{proposal.before.endTime}</AppText>
        <AppText style={styles.arrow}>↓</AppText>
        <AppText>{proposal.after.date} {proposal.after.startTime}–{proposal.after.endTime}</AppText>
        <AppText variant="caption" muted>理由：{proposal.reason}</AppText>
        <AppText variant="caption" muted>时长不变。你可以在计划页手动安排。</AppText>
        {service.canConfirm && operation ? <Button label="确认移动" loading={busy} disabled={busy} onPress={() => void confirm()} /> : null}
        <Button label="取消" variant="quiet" disabled={busy} onPress={() => setProposal(null)} />
      </View> : null}
      {result ? <Notice title={result.status === 'MOVED' ? '移动完成' : result.status === 'REJECTED' ? '移动被拒绝' : result.status === 'NEEDS_RECONCILIATION' ? '移动结果需要核验，请勿重试' : '移动失败'}>
        {result.message}{result.before && result.after
          ? `（${result.before.date} ${result.before.startTime}–${result.before.endTime} → ${result.after.date} ${result.after.startTime}–${result.after.endTime}）` : ''}
      </Notice> : null}
    </>}
    <AppText variant="caption" muted>当前阶段：{period.startDate} — {period.endDate}。本周起点：{weekStart}。</AppText>
  </ScreenSection>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  proposal: { gap: 8, paddingVertical: 4 },
  arrow: { textAlign: 'center' },
});
