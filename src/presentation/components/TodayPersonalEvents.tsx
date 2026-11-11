import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { TodayPersonalEvent } from '@/application/tasks/TodayExecutionService';
import { AppText } from './AppText';
import { Notice } from './Notice';
import { ScreenSection } from './Screen';
import { Card, SectionHeader } from './ui/Layout';
import { useTheme } from '@/presentation/theme/tokens';

export function TodayPersonalEvents({ events, disabled, onToggle }: {
  events: TodayPersonalEvent[]; disabled: boolean;
  onToggle: (id: string, completed: boolean) => Promise<void>;
}) {
  const theme = useTheme();
  const [pending, setPending] = useState<{ id: string; completed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  async function toggle(event: TodayPersonalEvent) {
    if (disabled || locked.current) return;
    locked.current = true;
    setPending({ id: event.id, completed: !event.completed }); setError(null);
    try { await onToggle(event.id, !event.completed); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '临时日程更新失败'); }
    finally { setPending(null); locked.current = false; }
  }
  if (!events.length) return null;
  return <ScreenSection>
    <SectionHeader title="临时日程" />
    {error ? <Notice title="临时日程更新失败，未确认的勾选已恢复">{error}</Notice> : null}
    {events.map(event => {
      const completed = pending?.id === event.id ? pending.completed : event.completed;
      return <Card key={event.id} style={{ ...styles.card, backgroundColor: theme.background, borderLeftColor: theme.textMuted }}>
        <View style={styles.row}>
          <View style={styles.text}>
            <AppText variant="caption" muted>{event.startTime}–{event.endTime}</AppText>
            <AppText variant="label" style={{ color: completed ? theme.textMuted : theme.text, textDecorationLine: completed ? 'line-through' : 'none' }}>{event.title}</AppText>
            <AppText variant="caption" muted>{completed ? '已完成' : '未完成'}</AppText>
          </View>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`标记${completed ? '未完成' : '完成'}：${event.title}`}
            accessibilityState={{ checked: completed, disabled: disabled || pending !== null }} disabled={disabled || pending !== null}
            onPress={() => void toggle(event)} style={styles.hit}>
            <View style={[styles.circle, { borderColor: theme.textMuted }]}>
              <AppText style={{ color: theme.textMuted }}>{completed ? '✓' : ''}</AppText>
            </View>
          </Pressable>
        </View>
      </Card>;
    })}
  </ScreenSection>;
}

const styles = StyleSheet.create({
  card: { borderLeftWidth: 3, paddingVertical: 14, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 3 },
  hit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 26, height: 26, borderWidth: 2, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
