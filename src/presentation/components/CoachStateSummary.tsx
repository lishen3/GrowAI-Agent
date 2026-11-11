import { StyleSheet, View } from 'react-native';
import { useState } from 'react';
import type { AgentContext } from '@/domain/agent/types';
import { AppText } from './AppText';
import { Button } from './Button';
import { useTheme } from '../theme/tokens';

const duration = (value: number | null) => value === null ? '未知（记录不足）' : `${value} min`;
export function CoachStateSummary({ context }: { context: AgentContext }) {
  const theme = useTheme();
  const [showDetails, setShowDetails] = useState(false);
  return <View style={[styles.summary, { borderColor: theme.border, backgroundColor: theme.surfaceStrong }]}>
    <AppText variant="label">{context.currentPeriod.name} · 第 {context.currentWeek.index} 周</AppText>
    <AppText variant="caption" muted>{context.currentWeek.windowStart} — {context.currentWeek.windowEnd}</AppText>
    <View style={styles.metrics}>
      <View style={styles.metric}><AppText variant="caption" muted>计划投入</AppText><AppText variant="heading">{duration(context.planVsReality.plannedMinutes)}</AppText></View>
      <View style={styles.metric}><AppText variant="caption" muted>已记录实际</AppText><AppText variant="heading">{duration(context.planVsReality.actualMinutes)}</AppText></View>
    </View>
    <AppText variant="caption">已完成 {context.planVsReality.completedTaskCount} 项 · 待执行 {context.planVsReality.unfinishedTaskCount} 项 · 已取消 {context.planVsReality.cancelledTaskCount} 项</AppText>
    <AppText variant="caption">本周目标 {context.weeklyGoals.length} 项 · 已确认记忆 {context.memories.length} 条</AppText>
    {context.weeklyGoals[0] ? <AppText variant="label" numberOfLines={2}>{context.weeklyGoals[0].title}</AppText> : <AppText variant="caption" muted>本周尚未设置目标。</AppText>}
    <Button label={showDetails ? '收起目标与记忆依据' : '查看目标与记忆依据'} variant="quiet" onPress={() => setShowDetails((value) => !value)} />
    {showDetails ? <View style={styles.details}>
      <AppText variant="label">本周目标</AppText>
      {context.weeklyGoals.map((goal) => <AppText variant="caption" key={goal.id}>
        {goal.title}{goal.targetValue != null && goal.targetUnit ? ` · 目标 ${goal.targetValue} ${goal.targetUnit}` : ''}
      </AppText>)}
      <AppText variant="label">已确认长期记忆</AppText>
      {context.memories.length ? context.memories.map((memory) => <View key={memory.id} style={styles.details}>
        <AppText variant="caption">{memory.content}</AppText>
        <AppText variant="caption" muted>证据：{memory.evidence}</AppText>
      </View>) : <AppText variant="caption" muted>暂无已确认记忆。</AppText>}
      <AppText variant="caption" muted>历史结论不等于本周执行事实。完整来源见下方“本周复盘与长期记忆”。</AppText>
    </View> : null}
    <AppText variant="caption" muted>来自数据库，不是 AI 推测；课表与具体时间安排尚未接入。</AppText>
  </View>;
}

const styles = StyleSheet.create({
  summary: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 9 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingVertical: 6 },
  metric: { flexGrow: 1, flexBasis: 120, gap: 4 },
  details: { gap: 6 },
});
