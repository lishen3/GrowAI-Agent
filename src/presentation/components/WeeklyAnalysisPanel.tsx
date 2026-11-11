import { AgentContextService } from '@/application/agent/AgentContextService';
import { WeeklyAnalysisService } from '@/application/analysis/WeeklyAnalysisService';
import type { WeeklyAnalysisResult } from '@/domain/analysis/types';
import { GrowAIBackendClient } from '@/infrastructure/ai/GrowAIBackendClient';
import { useGrowthStore } from '@/infrastructure/data/DataContext';
import { todayIso } from '@/shared/date';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { Notice } from './Notice';
import { useTheme } from '../theme/tokens';

type Props = { journeyId: string | null; onResult?: (result: WeeklyAnalysisResult) => void };

export function WeeklyAnalysisPanel({ journeyId, onResult }: Props) {
  const theme = useTheme();
  const store = useGrowthStore();
  const service = useMemo(() => new WeeklyAnalysisService(
    new AgentContextService(store),
    new GrowAIBackendClient(),
  ), [store]);
  const [analysis, setAnalysis] = useState<WeeklyAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    if (!journeyId) return;
    setLoading(true); setError(null); setAnalysis(null);
    try {
      const result = await service.analyze({ journeyId, date: todayIso() });
      setAnalysis(result);
      onResult?.(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '本周分析失败');
    } finally { setLoading(false); }
  }

  return (
    <View style={styles.wrap}>
      <Button
        label={loading ? '正在分析本周执行情况…' : '分析本周'}
        disabled={!journeyId}
        loading={loading}
        onPress={() => void analyze()}
      />
      {error ? <Notice title="AI 分析失败">{error}</Notice> : null}
      {analysis ? (
        <View style={[styles.result, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <AppText variant="heading">本周总结</AppText>
          <AppText variant="body">{analysis.summary}</AppText>
          <ResultList title="观察" items={analysis.observations.map((item) => `${item.title}：${item.evidence}`)} />
          <ResultList title="风险" items={analysis.risks.map((item) => `${item.title}：${item.reason}`)} />
          <ResultList title="建议" items={analysis.suggestions.map((item) => `${item.title}：${item.reason}`)} />
          <ResultList title="数据不足" items={analysis.data_gaps} emptyLabel="未发现明确的数据缺口" />
        </View>
      ) : null}
    </View>
  );
}

function ResultList({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel?: string }) {
  return (
    <View style={styles.list}>
      <AppText variant="label">{title}</AppText>
      {items.length ? items.map((item, index) => (
        <AppText key={`${title}-${index}`} variant="caption">• {item}</AppText>
      )) : <AppText variant="caption" muted>{emptyLabel ?? '无'}</AppText>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  result: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  list: { gap: 5 },
});
