import type { Period } from '@/domain/periods/types';
import { PERIOD_STATUS_LABELS, PERIOD_TYPE_LABELS } from '@/domain/periods/types';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/tokens';

type Props = { period: Period; current: boolean; onMakeCurrent: () => void };

export function PeriodRow({ period, current, onMakeCurrent }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onMakeCurrent}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.surface, borderColor: current ? theme.primary : theme.border },
        pressed && { opacity: 0.78 },
      ]}
    >
      <View style={styles.main}>
        <View style={styles.meta}>
          <AppText variant="eyebrow" style={{ color: current ? theme.primary : theme.textMuted }}>
            {PERIOD_TYPE_LABELS[period.type]} · {PERIOD_STATUS_LABELS[period.status]}
          </AppText>
          {current ? (
            <View style={[styles.current, { backgroundColor: theme.primarySoft }]}>
              <AppText variant="caption" style={{ color: theme.primary, fontWeight: '700' }}>当前</AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="heading">{period.name}</AppText>
        <AppText variant="caption" muted>{period.startDate} — {period.endDate}</AppText>
      </View>
      {!current && period.status !== 'COMPLETED' ? (
        <AppText variant="caption" style={{ color: theme.primary }}>设为当前</AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' },
  main: { flex: 1, gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  current: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
});
