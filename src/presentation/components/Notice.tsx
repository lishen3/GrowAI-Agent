import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/tokens';

export function Notice({ title, children }: PropsWithChildren & { title: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
      <AppText variant="label" style={{ color: theme.primary }}>{title}</AppText>
      <AppText variant="caption" muted>{children}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { borderLeftWidth: 3, borderRadius: 12, padding: 14, gap: 4 },
});
