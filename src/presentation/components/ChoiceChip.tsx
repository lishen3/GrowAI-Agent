import { Pressable, StyleSheet } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/tokens';

type ChoiceChipProps = { label: string; selected: boolean; onPress: () => void; compact?: boolean; tile?: boolean };

export function ChoiceChip({ label, selected, onPress, compact = false, tile = false }: ChoiceChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.primarySoft : theme.surface,
          borderColor: selected ? theme.primary : theme.border,
        },
        compact && { minHeight: 32, paddingHorizontal: 8, borderWidth: 0, backgroundColor: 'transparent',
          borderRadius: 0, borderBottomWidth: selected ? 2 : 0, borderBottomColor: theme.primary },
        tile && { flexGrow:1, flexBasis:'45%', alignItems:'flex-start', minHeight:62, paddingHorizontal:18,
          borderRadius:12, borderWidth:0, backgroundColor:selected?theme.primarySoft:theme.surface },
        pressed && { opacity: 0.72 },
      ]}
    >
      <AppText variant={tile ? 'heading' : 'caption'} style={tile ? {color:theme.primary,fontSize:18} : selected ? { color: theme.primary, fontWeight: '700' } : undefined}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 40, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
});
