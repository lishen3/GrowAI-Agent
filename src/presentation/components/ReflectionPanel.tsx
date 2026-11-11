import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AgentContextService } from '@/application/agent/AgentContextService';
import { MemoryApplicationService } from '@/application/memory/MemoryApplicationService';
import { WeeklyReflectionService } from '@/application/reflection/WeeklyReflectionService';
import type { Memory, MemoryCandidate } from '@/domain/memory/types';
import type { Reflection } from '@/domain/reflection/types';
import { ReflectionBackendClient } from '@/infrastructure/ai/ReflectionBackendClient';
import { useGrowthStore } from '@/infrastructure/data/DataContext';
import { todayIso } from '@/shared/date';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { GrowthReflectionCard } from './GrowthReflectionCard';

type CandidateProps = { candidate: MemoryCandidate; disabled: boolean; decision?: string; onSave: () => void; onIgnore: () => void };
export function MemoryCandidateCard({ candidate, disabled, decision, onSave, onIgnore }: CandidateProps) {
  return <View style={styles.card}>
    <AppText variant="label">{candidate.type} · {candidate.confidence}</AppText>
    <AppText>{candidate.content}</AppText>
    <AppText variant="caption" muted>证据：{candidate.evidence}</AppText>
    {decision ? <AppText variant="caption">{decision}</AppText> : <>
      <Button label="保存为长期记忆" disabled={disabled} onPress={onSave} />
      <Button label="忽略" variant="quiet" disabled={disabled} onPress={onIgnore} />
    </>}
  </View>;
}

export function ReflectionPanel({ journeyId }: { journeyId: string | null }) {
  const store = useGrowthStore();
  const memoryService = useMemo(() => new MemoryApplicationService(store), [store]);
  const reflectionService = useMemo(() => new WeeklyReflectionService(
    new AgentContextService(store), new ReflectionBackendClient(), store), [store]);
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setReflection(null); setDecisions({}); setMemories([]);
    if (journeyId) Promise.all([store.listReflections(journeyId), memoryService.listMemories(journeyId)])
      .then(([history, saved]) => { if (alive) { setReflection(history[0] ?? null); setMemories(saved); } })
      .catch((caught) => { if (alive) setError(String(caught)); });
    return () => { alive = false; };
  }, [journeyId, store, memoryService]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败'); }
    finally { setBusy(false); }
  }

  async function save(index: number) {
    if (!journeyId || !reflection) return;
    const memory = await reflectionService.confirmCandidate(journeyId, reflection.id, index);
    setDecisions((previous) => ({ ...previous, [index]: memory.status === 'ACTIVE' ? '已保存（相同记忆不会重复创建）' : '相同记忆已归档，未自动重新激活' }));
    setMemories(await memoryService.listMemories(journeyId));
  }

  return <View style={styles.wrap}>
    <AppText variant="heading">本周复盘</AppText>
    <AppText variant="caption" muted>事实、AI 分析与长期结论分开显示。建议记住的内容不会自动保存。</AppText>
    <Button label="生成本周复盘" disabled={!journeyId} loading={busy} onPress={() => void run(async () => {
      if (!journeyId) return;
      const next = await reflectionService.generate({ journeyId, date: todayIso() });
      setReflection(next); setDecisions({});
    })} />
    {error ? <Notice title="操作未完成">{error}</Notice> : null}
    {reflection ? <View style={styles.card}>
      <AppText variant="caption" muted>{reflection.startDate} — {reflection.endDate} · 最近保存的复盘</AppText>
      <GrowthReflectionCard reflection={reflection} />
      {reflection.memoryCandidates.length > 0 ? <AppText variant="label">建议记住</AppText> : null}
      {reflection.memoryCandidates.map((candidate, index) => <MemoryCandidateCard key={`${reflection.id}-${index}`}
        candidate={candidate} disabled={busy} decision={decisions[index]}
        onSave={() => void run(() => save(index))}
        onIgnore={() => setDecisions((previous) => ({ ...previous, [index]: '已忽略，未写入长期记忆' }))} />)}
    </View> : null}
    <AppText variant="heading">长期记忆</AppText>
    <AppText variant="caption" muted>这是用户确认的结论，不等于执行事实。归档后保留历史，但不再进入 AI 上下文。</AppText>
    {memories.length === 0 ? <AppText muted>暂无已确认记忆。</AppText> : null}
    {memories.map((memory) => <View style={styles.card} key={memory.id}>
      <AppText variant="label">{memory.type} · {memory.confidence} · {memory.status}</AppText>
      <AppText>{memory.content}</AppText><AppText variant="caption" muted>证据：{memory.evidence}</AppText>
      <AppText variant="caption" muted>来源：{memory.sourceType} · {memory.sourceId ?? '用户陈述'}</AppText>
      {memory.status === 'ACTIVE' ? <Button label="归档" variant="quiet" disabled={busy} onPress={() => void run(async () => {
        if (!journeyId) return;
        await memoryService.archiveMemory(journeyId, memory.id);
        setMemories(await memoryService.listMemories(journeyId));
      })} /> : null}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({ wrap: { gap: 12 }, card: { gap: 8, paddingVertical: 10 } });
