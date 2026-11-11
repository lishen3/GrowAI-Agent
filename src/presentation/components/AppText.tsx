import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';
import { useTheme } from '../theme/tokens';

type Variant = 'eyebrow' | 'title' | 'heading' | 'body' | 'label' | 'caption';

type AppTextProps = TextProps & PropsWithChildren & {
  variant?: Variant;
  muted?: boolean;
};

export function AppText({ variant = 'body', muted, style, children, ...props }: AppTextProps) {
  const theme = useTheme();
  return (
    <Text
      {...props}
      style={[styles.base, styles[variant], { color: muted ? theme.textMuted : theme.text }, style]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: { fontSize: 15, lineHeight: 23 },
  eyebrow: { fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.7 },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 23, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '400' },
});
