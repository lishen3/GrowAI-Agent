import { CalendarEventGesture } from './CalendarEventGesture';
import { calendarDrop, calendarTime } from '@/domain/scheduling/calendarInteraction';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { addDays, getDay, parseISO, startOfWeek } from 'date-fns';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { todayIso } from '@/shared/date';
import { AppText } from '@/presentation/components/AppText';
import { useTheme, type Theme } from '@/presentation/theme/tokens';

const TIME_GUTTER = 46;
const HEADER_HEIGHT = 48;
const HOUR_HEIGHT = 56;
const MIN_BLOCK_HEIGHT = 26;
const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

type Conflict = { eventAId: string; eventBId: string };

type Positioned = { event: ScheduleEvent; lane: number; laneCount: number };

function toMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function hourLabel(minutes: number): string {
  return calendarTime(minutes);
}

function weekdayLabel(day: string): string {
  const index = getDay(parseISO(day));
  return WEEKDAY_LABELS[index === 0 ? 6 : index - 1];
}

function displayEndMinutes(event: ScheduleEvent): number {
  // Lane assignment must also include the minimum space used to draw a short class.
  return Math.max(toMinutes(event.endTime), toMinutes(event.startTime) + MIN_BLOCK_HEIGHT / HOUR_HEIGHT * 60);
}

function layout(events: ScheduleEvent[]): Positioned[] {
  const sorted = [...events].sort((a, b) => a.startTime.localeCompare(b.startTime)
    || a.endTime.localeCompare(b.endTime) || a.id.localeCompare(b.id));
  const result: Positioned[] = [];
  let cluster: ScheduleEvent[] = [];
  let clusterEnd = 0;
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const placed = cluster.map((event) => {
      const start = toMinutes(event.startTime);
      let lane = laneEnds.findIndex((end) => end <= start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = displayEndMinutes(event);
      return { event, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);
    for (const item of placed) result.push({ ...item, laneCount });
    cluster = [];
    clusterEnd = 0;
  };
  for (const event of sorted) {
    if (cluster.length && toMinutes(event.startTime) >= clusterEnd) flush();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, displayEndMinutes(event));
  }
  flush();
  return result;
}

function eventPalette(event: ScheduleEvent, theme: Theme) {
  if (event.type === 'COURSE') {
    return { background: theme.primarySoft, border: theme.primary, text: theme.primary, label: '课程 · 固定' };
  }
  if (event.type === 'PERSONAL') {
    return { background: theme.warningSoft, border: theme.warning, text: theme.warning, label: '临时日程' };
  }
  if (event.type === 'AI_ADJUSTMENT') {
    return { background: theme.surfaceStrong, border: theme.textMuted, text: theme.textMuted, label: 'AI 调整' };
  }
  return { background: theme.surfaceStrong, border: theme.primary, text: theme.text, label: '任务' };
}

export function WeeklyScheduleBoard({ weekStart, weekEnd, weekStartsOn = 1, events, conflicts = [], onSelectEvent, onCreateSlot, disabled, categoryName, selectedSlot, onChangeEvent, onInteractionError, slotActionLabel = '新建安排' }: {
  onChangeEvent?: (before: ScheduleEvent, after: ScheduleEvent) => Promise<void>;
  onInteractionError?: (text: string) => void;
  weekStart: string;
  weekEnd?: string;
  weekStartsOn?: 1 | 7;
  events: ScheduleEvent[];
  conflicts?: Conflict[];
  onSelectEvent?: (event: ScheduleEvent) => void;
  onCreateSlot?: (date: string, startTime: string, endTime: string) => void;
  disabled?: boolean;
  categoryName?: (id: string) => string;
  slotActionLabel?: string;
  selectedSlot?: { date: string; startTime: string } | null;
}) {
  const theme = useTheme();
  const [columnWidth, setColumnWidth] = useState(40);
  const days = useMemo(() => {
    const first = startOfWeek(parseISO(weekStart), { weekStartsOn: weekStartsOn === 7 ? 0 : 1 });
    return Array.from({ length: 7 }, (_, index) => todayIso(addDays(first, index)));
  }, [weekStart, weekStartsOn]);
  const startMinutes = useMemo(() => {
    const earliest = events.reduce((value, event) => Math.min(value, toMinutes(event.startTime)), 8 * 60);
    return Math.floor(earliest / 60) * 60;
  }, [events]);
  const endMinutes = useMemo(() => {
    const latest = events.reduce((value, event) => Math.max(value, toMinutes(event.endTime)), 22 * 60);
    return Math.min(24 * 60, Math.ceil(latest / 60) * 60);
  }, [events]);
  const bodyHeight = ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT;
  const hours = useMemo(() => {
    const values: number[] = [];
    for (let minute = startMinutes; minute <= endMinutes; minute += 60) values.push(minute);
    return values;
  }, [startMinutes, endMinutes]);
  const conflictIds = useMemo(() => new Set(conflicts.flatMap((item) => [item.eventAId, item.eventBId])), [conflicts]);
  const today = todayIso();

  return <View style={styles.board} accessibilityLabel="一周时间表">
    <View style={{ width: TIME_GUTTER, flexShrink: 0 }}>
      <View style={{ height: HEADER_HEIGHT }} />
      {hours.map((minute) => <View key={minute} style={[styles.timeCell, { height: HOUR_HEIGHT }]}>
        <AppText variant="caption" muted style={styles.timeText}>{hourLabel(minute)}</AppText>
      </View>)}
    </View>
    {days.map((day) => {
      const dayEvents = layout(events.filter((event) => event.date === day));
      const isToday = day === today;
      return <View key={day} onLayout={e => setColumnWidth(e.nativeEvent.layout.width)} style={[styles.dayColumn, { borderColor: theme.border }]}>
        <View style={[styles.dayHeader, { height: HEADER_HEIGHT, borderColor: theme.border,
          backgroundColor: isToday ? theme.primarySoft : 'transparent' }]}>
          <AppText variant="label" numberOfLines={1} ellipsizeMode="tail" style={[styles.weekdayText, isToday ? { color: theme.primary } : undefined]}>{weekdayLabel(day)}</AppText>
          <AppText variant="caption" muted numberOfLines={1} ellipsizeMode="tail" style={styles.dateText}>{day.slice(5)}</AppText>
        </View>
        <View style={{ height: bodyHeight, position: 'relative' }}>
          {hours.map((minute) => <View key={minute} style={[styles.hourLine, {
            top: ((minute - startMinutes) / 60) * HOUR_HEIGHT, borderColor: theme.border,
          }]} />)}
          {Array.from({length: (endMinutes - startMinutes) / 15}, (_, i) => startMinutes + i * 15).map((minute) => <Pressable key={`slot:${minute}`}
            disabled={disabled || minute >= 23*60+45 || !onCreateSlot || day < weekStart || !!weekEnd && day > weekEnd}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedSlot?.date === day && selectedSlot.startTime === hourLabel(minute) }}
            accessibilityLabel={`${weekdayLabel(day)} ${hourLabel(minute)} ${slotActionLabel}`}
            onPress={() => onCreateSlot?.(day, hourLabel(minute), hourLabel(Math.min(minute + 60, 23 * 60 + 45)))}
            style={[styles.slot, { top: ((minute - startMinutes) / 60) * HOUR_HEIGHT, height: HOUR_HEIGHT / 4 },
              selectedSlot?.date === day && selectedSlot.startTime === hourLabel(minute)
                ? { backgroundColor: theme.primarySoft, borderColor: theme.primary, borderWidth: 2 } : undefined]} />)}
          {dayEvents.map(({ event, lane, laneCount }) => {
            const top = ((toMinutes(event.startTime) - startMinutes) / 60) * HOUR_HEIGHT;
            const height = Math.max(MIN_BLOCK_HEIGHT, ((toMinutes(event.endTime) - toMinutes(event.startTime)) / 60) * HOUR_HEIGHT - 3);
            const palette = eventPalette(event, theme);
            const conflicting = conflictIds.has(event.id);
            const compact = height < 42;
            return <CalendarEventGesture key={event.id} event={event} disabled={!!disabled} onCommit={onChangeEvent} onError={onInteractionError}
              candidate={(dx,dy,resize) => calendarDrop(event, Math.round(dx / columnWidth), dy / HOUR_HEIGHT * 60, resize)}
              style={{position:'absolute',top,height,left:`${lane/laneCount*100}%`,width:`${100/laneCount}%`}}>
              <Pressable disabled={disabled || !onSelectEvent}
              accessibilityRole="button" accessibilityLabel={`${event.title} ${event.startTime} 到 ${event.endTime}`}
              onPress={() => onSelectEvent?.(event)}
              style={[styles.block, {
                position: 'relative', top: 0, height: '100%',
                left: 0,
                width: '100%',
                backgroundColor: palette.background,
                borderColor: conflicting ? theme.warning : palette.border,
                borderWidth: conflicting ? 2 : 1,
                borderStyle: event.id.startsWith('preview-') ? 'dashed' : 'solid', opacity: event.id.startsWith('preview-') ? 0.65 : 1,
              }]}>
              <AppText variant="caption" numberOfLines={compact ? 1 : 2} ellipsizeMode="tail"
                style={[styles.blockTitle, { color: palette.text }]}>
                {event.title}
              </AppText>
              {!compact ? <AppText variant="caption" numberOfLines={1} ellipsizeMode="tail" style={[styles.blockMeta, { color: palette.text }]}>
                {event.startTime}–{event.endTime}
              </AppText> : null}
              {height >= 56 ? <AppText variant="caption" numberOfLines={1} ellipsizeMode="tail" style={[styles.blockMeta, { color: palette.text }]}>
                {palette.label}{event.categoryId && categoryName ? ' · ' + categoryName(event.categoryId) : ''}{conflicting ? ' · 冲突' : ''}
              </AppText> : null}
            </Pressable></CalendarEventGesture>;
          })}
        </View>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  board: { flexDirection: 'row', width: '100%', minWidth: 0, paddingBottom: 4, overflow: 'hidden' },
  timeCell: { justifyContent: 'flex-start', paddingTop: 2, paddingRight: 4, alignItems: 'flex-end' },
  timeText: { fontSize: 11, lineHeight: 14 },
  dayColumn: { flex: 1, minWidth: 0, overflow: 'hidden', borderLeftWidth: StyleSheet.hairlineWidth },
  dayHeader: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 1, paddingVertical: 4, alignItems: 'center', gap: 1 },
  weekdayText: { fontSize: 12, lineHeight: 18 },
  dateText: { fontSize: 10, lineHeight: 14 },
  hourLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth },
  slot: { position: 'absolute', left: 0, right: 0 },
  block: { position: 'absolute', borderRadius: 8, paddingHorizontal: 4, paddingVertical: 3, overflow: 'hidden' },
  blockTitle: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  blockMeta: { fontSize: 10, lineHeight: 13, opacity: 0.9 },
});
