import { View, StyleSheet } from 'react-native';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { AppText } from '@/presentation/components/AppText';
import { useTheme } from '@/presentation/theme/tokens';
import { Button } from '@/presentation/components/Button';

const TYPE_LABELS = { TASK: '任务', COURSE: '固定课程', PERSONAL: '我的安排', AI_ADJUSTMENT: 'AI 调整' } as const;
const SOURCE_LABELS = { USER: '用户', SYSTEM: '系统', AI: 'AI' } as const;

export function ScheduleEventCard({ event, onEdit, onDelete, disabled = false }: {
  event: ScheduleEvent; onEdit?: (event: ScheduleEvent) => void; onDelete?: (event: ScheduleEvent) => void; disabled?: boolean;
}) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
    <AppText variant="label" style={{ color: theme.primary }}>{event.startTime} – {event.endTime}</AppText>
    <AppText variant="heading">{event.title}</AppText>
    <AppText variant="caption" muted>类型：{TYPE_LABELS[event.type]}（{event.type}） · 来源：{SOURCE_LABELS[event.source]}（{event.source}）</AppText>
    {event.source === 'USER' ? <>
      {onEdit ? <Button label="编辑" variant="secondary" disabled={disabled} onPress={() => onEdit(event)} /> : null}
      {onDelete ? <Button label="删除" variant="quiet" disabled={disabled} onPress={() => onDelete(event)} /> : null}
    </> : event.source === 'SYSTEM' ? <AppText variant="caption" muted>固定课程 · 只读</AppText>
      : <AppText variant="caption" muted>AI 调整记录 · 当前只读</AppText>}
  </View>;
}
const styles = StyleSheet.create({ card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 } });
