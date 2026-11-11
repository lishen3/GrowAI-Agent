import { StyleSheet, View } from 'react-native';
import type { Task, Achievement } from '@/domain/tasks/types';
import type { WeeklyGoal } from '@/domain/goals/planningTypes';
import { AppText } from './AppText';
import { Button } from './Button';
import { useTheme } from '../theme/tokens';

const priorityOrder = { S: 0, A: 1, B: 2, C: 3 };
export function selectTodayFocus(tasks: Task[]): Task | undefined {
  return tasks.filter((task) => task.status !== 'DONE' && task.status !== 'CANCELLED')
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])[0];
}

export function TodayFocus({ task, goal, onCoach }: { task?: Task; goal?: WeeklyGoal; onCoach: () => void }) {
  const theme = useTheme();
  return <View style={[styles.focus, { backgroundColor: theme.primarySoft, borderColor: theme.border }]}>
    <AppText variant="eyebrow" style={{ color: theme.primary }}>今天的重点</AppText>
    <AppText variant="heading">{task?.title ?? '给今天留一点空间'}</AppText>
    <AppText variant="caption" muted>{task
      ? `${task.priority} 优先级 · ${task.estimatedMinutes == null ? '未估时' : `预计 ${task.estimatedMinutes} min`} · 按已有优先级展示`
      : '没有待执行任务。可以添加任务，或和成长助手讨论下一步。'}</AppText>
    {goal ? <AppText variant="caption">推进本周目标：{goal.title}</AppText> : null}
    <Button label="计划有变化？告诉 AI Coach" variant="secondary" onPress={onCoach} />
  </View>;
}

export function TodayTimeline({ tasks, achievements }: { tasks: Task[]; achievements: Achievement[] }) {
  const theme = useTheme();
  const pending = tasks.filter((task) => task.status !== 'DONE' && task.status !== 'CANCELLED');
  const completed = [...achievements].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return <View style={styles.timeline}>
    <AppText variant="caption" muted>当前任务尚无具体起止时段；以下不是课表，不代表空闲时间。</AppText>
    {pending.map((task) => <View key={task.id} style={[styles.row, { borderLeftColor: theme.border }]}>
      <AppText variant="caption" muted>未设置时段 · 计划</AppText>
      <AppText variant="label">{task.title}</AppText>
    </View>)}
    {completed.map((item) => <View key={item.id} style={[styles.row, { borderLeftColor: theme.primary }]}>
      <AppText variant="caption" muted>{new Date(item.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} · 成果记录时间</AppText>
      <AppText variant="label">✓ {item.title}</AppText>
    </View>)}
    {!pending.length && !completed.length ? <AppText muted>今天还没有计划或成果记录。</AppText> : null}
  </View>;
}

export function AchievementCard({ achievement: item, expanded, onToggle }: {
  achievement: Achievement; expanded: boolean; onToggle: () => void;
}) {
  const theme = useTheme();
  return <View style={[styles.achievement, { borderColor: theme.border, backgroundColor: theme.surface }]}>
    <AppText variant="label">✓ {item.title}</AppText>
    <AppText variant="caption" muted>{item.actualDuration == null ? '未记录实际时长' : `实际 ${item.actualDuration} min`}{item.result ? ` · ${item.result}` : ''}</AppText>
    <Button label={expanded ? '收起成果详情' : '查看成果详情'} variant="quiet" onPress={onToggle} />
    {expanded ? <View style={styles.detail}>
      <AppText variant="caption">计划快照：{item.plannedDurationSnapshot == null ? '未估时' : `${item.plannedDurationSnapshot} min`}</AppText>
      <AppText variant="caption">记录时间：{new Date(item.occurredAt).toLocaleString('zh-CN')}</AppText>
      {item.description ? <AppText>完成说明：{item.description}</AppText> : null}
      {item.summary ? <AppText>总结：{item.summary}</AppText> : null}
      <AppText variant="caption" muted>来自已保存成果，不随任务计划变化而消失。</AppText>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  focus: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 10 },
  timeline: { gap: 12 },
  row: { borderLeftWidth: 2, paddingLeft: 14, paddingVertical: 4, gap: 3 },
  achievement: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  detail: { gap: 6 },
});
