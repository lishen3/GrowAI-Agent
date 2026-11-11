import { View, StyleSheet } from 'react-native';
import type { Task } from '@/domain/tasks/types';
import { AppText } from '@/presentation/components/AppText';
import { useTheme } from '@/presentation/theme/tokens';
import { Button } from '@/presentation/components/Button';

export function UnscheduledTaskList({ tasks, onSchedule, disabled = false }: { tasks: Task[]; onSchedule?: (task: Task) => void; disabled?: boolean }) {
  const theme = useTheme();
  if (tasks.length === 0) return <AppText muted>暂无待安排任务</AppText>;
  return <View style={styles.list}>{tasks.map((task) => <View key={task.id}
    style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
    <AppText variant="label">{task.title}</AppText>
    <AppText variant="caption" muted>{task.estimatedMinutes === null ? '预计时间未填写' : `预计 ${task.estimatedMinutes} 分钟`}</AppText>
    {onSchedule ? <Button label="安排时间" variant="secondary" disabled={disabled} onPress={() => onSchedule(task)} /> : null}
  </View>)}</View>;
}
const styles = StyleSheet.create({ list: { gap: 10 }, card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 } });
