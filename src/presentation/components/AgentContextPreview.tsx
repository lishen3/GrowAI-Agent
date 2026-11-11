import { AgentContextService } from '@/application/agent/AgentContextService';
import type { AgentContext } from '@/domain/agent/types';
import { useGrowthStore } from '@/infrastructure/data/DataContext';
import { todayIso } from '@/shared/date';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { useTheme } from '../theme/tokens';

type Props = { journeyId: string | null };

function minutes(value: number | null): string {
  return value === null ? '数据不足' : `${value} 分钟`;
}

export function AgentContextPreview({ journeyId }: Props) {
  const theme = useTheme();
  const store = useGrowthStore();
  const service = useMemo(() => new AgentContextService(store), [store]);
  const [context, setContext] = useState<AgentContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buildPreview() {
    if (!journeyId) return;
    setLoading(true); setError(null);
    try {
      setContext(await service.build({ journeyId, date: todayIso() }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Agent Context 生成失败');
    } finally { setLoading(false); }
  }

  return (
    <View style={styles.wrap}>
      <Button
        label={context ? '刷新 Agent Context' : '查看 Agent Context'}
        variant="secondary"
        disabled={!journeyId}
        loading={loading}
        onPress={() => void buildPreview()}
      />
      {error ? <Notice title="Context 生成失败">{error}</Notice> : null}
      {context ? (
        <View style={[styles.preview, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <AppText variant="label">{context.currentPeriod.name} · 第 {context.currentWeek.index} 周</AppText>
          <AppText variant="caption" muted>{context.currentWeek.windowStart} — {context.currentWeek.windowEnd}</AppText>
          <View style={styles.metrics}>
            <View style={styles.metric}><AppText variant="heading">{context.planVsReality.plannedTaskCount}</AppText><AppText variant="caption" muted>计划任务</AppText></View>
            <View style={styles.metric}><AppText variant="heading">{context.planVsReality.completedTaskCount}</AppText><AppText variant="caption" muted>已完成</AppText></View>
            <View style={styles.metric}><AppText variant="heading">{context.recentAchievements.length}</AppText><AppText variant="caption" muted>成果</AppText></View>
          </View>
          <AppText variant="caption">计划投入：{minutes(context.planVsReality.plannedMinutes)}</AppText>
          <AppText variant="caption">实际投入：{minutes(context.planVsReality.actualMinutes)}</AppText>
          <AppText variant="caption">已确认长期记忆：{context.memories.length} 条（最多 20 条）</AppText>
          {context.recentAchievements.slice(0, 3).map((item) => (
            <AppText key={item.id} variant="caption" muted>✓ {item.title}</AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  preview: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 7 },
  metrics: { flexDirection: 'row', gap: 8, paddingVertical: 6 },
  metric: { flex: 1, gap: 2 },
});
