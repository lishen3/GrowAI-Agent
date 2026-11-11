import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { Reflection } from '@/domain/reflection/types';
import { AppText } from './AppText';

const internalId = /\b(?:(?:wg|pg)_[a-z0-9_]+|[a-z]{2}_\d{2}_[a-z][a-z0-9_]*)\b/gi;
function readable(value: string, titles: Map<string, string>) {
  return value.split(/\r?\n/).filter(paragraph => !/证据\s*[:：]|reviewFacts|reviewSnapshot|\b(?:WEEKLY_GOAL|PERIOD_GOAL|TASK_EXECUTION|EXECUTION|actualMinutes|plannedMinutes|estimatedMinutes|plannedTaskCount|completedTaskCount)\b/i.test(paragraph))
    .join('\n').replace(internalId, id => (titles.get(id) ?? (id.toLowerCase().startsWith('wg_') ? '每周目标' : id.toLowerCase().startsWith('pg_') ? '阶段目标' : '相关目标')).replace(internalId, '相关目标')).trim();
}
export function GrowthReflectionCard({ reflection }: { reflection: Reflection; children?: ReactNode }) {
  const snapshot = reflection.reviewSnapshot;
  const titles = new Map(snapshot?.goals.map(goal => [goal.id, goal.title]));
  for (const row of snapshot?.evidence ?? []) {
    if (row.reference.field === 'title' && typeof row.reference.value === 'string') titles.set(row.reference.id, row.reference.value);
  }
  const facts = snapshot?.facts;
  const summary = facts
    ? `本周计划任务 ${facts.plannedTaskCount} 项。本周已完成任务 ${facts.completedTaskCount} 项。`
      + (facts.actualMinutes === null ? '本周计划任务实际用时记录不完整。' : `本周计划任务已记录实际用时 ${facts.actualMinutes} 分钟。`)
      + `本周记录成果 ${facts.achievementCount} 项。`
    : readable(reflection.summary ?? '', titles) || '暂无可直接展示的总体小结。';
  const suggestions = reflection.growth?.nextWeekSuggestions.map(item => readable(item.content, titles)).filter(Boolean) ?? [];
  const progress = snapshot ? reflection.growth?.goalAnalyses.map(goal => ({
    title: readable(snapshot.goals.find(row => row.id === goal.goalId)?.title ?? '', titles),
    text: readable(goal.explanation, titles),
  })).filter(item => item.title && item.text) ?? [] : [];
  return <View style={{ gap: 8 }}>
    <AppText variant="label">总体小结</AppText>
    {!facts && reflection.summary ? <AppText variant="caption" muted>历史摘要缺少统计快照，数字无法核对。</AppText> : null}
    <AppText>{summary.length > 160 ? summary.slice(0, 160) + '…' : summary}</AppText>
    <AppText variant="label">行动建议</AppText>
    {suggestions.length ? suggestions.slice(0, 3).map((suggestion, index) => <AppText key={index}>{suggestion.slice(0, 120)}</AppText>) : <AppText muted>暂时没有可直接展示的行动建议。</AppText>}
    <AppText variant="label">目标进展</AppText>
    {progress.length ? progress.slice(0, 3).map((item, index) => <AppText key={index}>{item.title}：{item.text.slice(0, 160)}</AppText>) : <AppText muted>暂时无法判断目标进展。</AppText>}
    <AppText variant="caption" muted>分析仅供参考，不是已验证事实；建议不会自动执行。</AppText>
  </View>;
}
