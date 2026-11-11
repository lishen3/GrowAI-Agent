import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { AppText } from '../AppText';
import { Button } from '../Button';
import { useTheme } from '../../theme/tokens';

export function PageHeader({ eyebrow, title, subtitle, action }: {
  eyebrow?: string; title: string; subtitle?: string; action?: ReactNode;
}) {
  return <View style={styles.pageHeader}>
    <View style={styles.pageHeaderText}>
      {eyebrow ? <AppText variant="eyebrow" muted>{eyebrow}</AppText> : null}
      <AppText variant="title">{title}</AppText>
      {subtitle ? <AppText muted>{subtitle}</AppText> : null}
    </View>
    {action ? <View>{action}</View> : null}
  </View>;
}

export function SectionHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: ReactNode;
}) {
  return <View style={styles.sectionHeader}>
    <View style={styles.sectionText}>
      <AppText variant="heading">{title}</AppText>
      {subtitle ? <AppText variant="caption" muted>{subtitle}</AppText> : null}
    </View>
    {action ? <View>{action}</View> : null}
  </View>;
}

export function Card({ children, style, tone = 'surface' }: PropsWithChildren & {
  style?: ViewStyle; tone?: 'surface' | 'soft' | 'plain';
}) {
  const theme = useTheme();
  return <View style={[styles.card, {
    backgroundColor: tone === 'soft' ? theme.primarySoft : tone === 'plain' ? 'transparent' : theme.surface,
    borderColor: tone === 'soft' ? 'transparent' : theme.border,
    borderWidth: tone === 'plain' ? 0 : 1,
  }, style]}>{children}</View>;
}

export function EmptyState({ title, body, actionLabel, onAction }: {
  title: string; body: string; actionLabel?: string; onAction?: () => void;
}) {
  return <View style={styles.empty}>
    <AppText variant="heading">{title}</AppText>
    <AppText muted>{body}</AppText>
    {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
  </View>;
}

export function ListRow({ title, subtitle, meta, onPress, disabled }: {
  title: string; subtitle?: string; meta?: string; onPress?: () => void; disabled?: boolean;
}) {
  const theme = useTheme();
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={disabled || !onPress}
    onPress={onPress} style={({ pressed }) => [styles.row, { borderColor: theme.border },
    pressed && onPress ? { opacity: 0.65 } : null]}>
    <View style={styles.rowText}>
      <AppText variant="label">{title}</AppText>
      {subtitle ? <AppText variant="caption" muted>{subtitle}</AppText> : null}
    </View>
    {meta ? <AppText variant="caption" muted>{meta}</AppText> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  pageHeader: { gap: 8 },
  pageHeaderText: { gap: 6 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  sectionText: { flex: 1, gap: 3 },
  card: { borderRadius: 20, padding: 18, gap: 10 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 20, padding: 22, gap: 10, alignItems: 'flex-start' },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 2 },
});
