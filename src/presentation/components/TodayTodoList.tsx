import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { TodayTodo } from '@/application/hooks/todayTodos';
import type { Task } from '@/domain/tasks/types';
import { AppText } from './AppText';
import { Notice } from './Notice';
import { Card } from './ui/Layout';
import { useTheme } from '@/presentation/theme/tokens';

export function TodayTodoList({ items, disabled, categoryName, onTask, onPersonal }: {
  items: TodayTodo[]; disabled: boolean; categoryName: (id: string) => string;
  onTask: (task: Task) => void; onPersonal: (id: string, completed: boolean) => Promise<void>;
}) {
  const theme = useTheme();
  const [pending, setPending] = useState<{ key: string; completed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function toggle(item: TodayTodo) {
    if (disabled || lock.current) return;
    if (item.kind === 'task') {
      if (item.completed) return;
      try { onTask(item.task); } catch (caught) { setError(caught instanceof Error ? caught.message : '请重新读取今日数据'); }
      return;
    }
    lock.current = true; setError(null); setPending({ key: item.key, completed: !item.completed });
    try { await onPersonal(item.id, !item.completed); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '请稍后再试'); }
    finally { setPending(null); lock.current = false; }
  }
  return <>
    {error ? <Notice title="未能更新，勾选已恢复">{error}</Notice> : null}
    {items.map(item => {
      const completed = pending?.key === item.key ? pending.completed : item.completed;
      const detail = [...item.times, ...(item.kind === 'task' ? [categoryName(item.task.categoryId ?? item.task.category)] : [])].join(' · ');
      return <Card key={item.key} style={styles.card}>
        <View style={styles.row}>
          <View style={styles.text}>
            <AppText variant="label" style={{ color: completed ? theme.textMuted : theme.text, textDecorationLine: completed ? 'line-through' : 'none' }}>{item.title}</AppText>
            {detail ? <AppText variant="caption" muted>{detail}</AppText> : null}
          </View>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.kind === 'task' && completed ? '已完成' : completed ? '标记未完成' : '标记完成'}：${item.title}`}
            accessibilityState={{ checked: completed, disabled: disabled || pending !== null || item.kind === 'task' && completed }} disabled={disabled || pending !== null || item.kind === 'task' && completed}
            onPress={() => void toggle(item)} style={styles.hit}>
            <View style={[styles.circle, { borderColor: completed ? theme.textMuted : theme.primary }]}>
              <AppText style={{ color: theme.textMuted }}>{completed ? '✓' : ''}</AppText>
            </View>
          </Pressable>
        </View>
      </Card>;
    })}
  </>;
}

const styles = StyleSheet.create({
  card: { paddingVertical: 16, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 5 },
  hit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 26, height: 26, borderWidth: 2, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
