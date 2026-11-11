import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/tokens';

type FieldProps = TextInputProps & { label: string };

export function Field({ label, style, ...props }: FieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        accessibilityLabel={props.accessibilityLabel ?? label}
        aria-label={props['aria-label'] ?? props.accessibilityLabel ?? label}
        {...props}
        placeholderTextColor={theme.textMuted}
        selectionColor={theme.primary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.surfaceStrong, borderColor: theme.border },
          props.multiline && styles.multiline,
          style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 7 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
});
