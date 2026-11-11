import { View, StyleSheet } from 'react-native';
import { parseISO } from 'date-fns';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { AppText } from '@/presentation/components/AppText';
import { useTheme } from '@/presentation/theme/tokens';
import { ScheduleEventCard } from './ScheduleEventCard';

export function WeeklyTimeline({ events, conflicts = [], onEdit, onDelete, disabled }: {
  events: ScheduleEvent[]; conflicts?: { eventAId: string; eventBId: string }[];
  onEdit?: (event: ScheduleEvent) => void; onDelete?: (event: ScheduleEvent) => void; disabled?: boolean;
}) {
  const theme = useTheme();
  if (events.length === 0) return <AppText muted>本周暂无安排</AppText>;
  const sorted = [...events].sort((a, b) => `${a.date}${a.startTime}${a.id}`.localeCompare(`${b.date}${b.startTime}${b.id}`));
  const eventsById = new Map(sorted.map((event) => [event.id, event]));
  return <View style={styles.list}>
    {conflicts.length > 0 ? <View style={[styles.conflicts, { borderColor: theme.warning, backgroundColor: theme.warningSoft }]}>
      <AppText variant="label" style={{ color: theme.warning }}>发现 {conflicts.length} 处时间重叠</AppText>
      {conflicts.map((conflict) => {
        const eventA = eventsById.get(conflict.eventAId);
        const eventB = eventsById.get(conflict.eventBId);
        if (!eventA || !eventB) return null;
        return <AppText key={`${conflict.eventAId}:${conflict.eventBId}`} variant="caption" muted>
          {eventA.date} · {eventA.title}（{eventA.startTime}–{eventA.endTime}）与 {eventB.title}（{eventB.startTime}–{eventB.endTime}）重叠
        </AppText>;
      })}
    </View> : null}
    {sorted.map((event, index) => <View key={event.id} style={styles.list}>
      {index === 0 || sorted[index - 1].date !== event.date ? <AppText variant="label">
        {event.date} · {new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(parseISO(event.date))}
      </AppText> : null}
      <ScheduleEventCard event={event} onEdit={onEdit} onDelete={onDelete} disabled={disabled} />
    </View>)}
  </View>;
}
const styles = StyleSheet.create({ list: { gap: 12 }, conflicts: { borderLeftWidth: 3, borderRadius: 12, padding: 14, gap: 4 } });
