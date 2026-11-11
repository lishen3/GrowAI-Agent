import { useColorScheme } from 'react-native';

const light = {
  background: '#F3F4FA',
  surface: '#FFFFFF',
  surfaceStrong: '#FFFFFF',
  text: '#20203D',
  textMuted: '#586077',
  border: '#DDDFF0',
  primary: '#44419D',
  primarySoft: '#E8E7FC',
  warning: '#B36A32',
  warningSoft: '#F7E9DC',
  tab: '#FFFFFF',
  shadow: '#20203D',
};

const dark = {
  background: '#131321',
  surface: '#202032',
  surfaceStrong: '#2A293F',
  text: '#F3F2FF',
  textMuted: '#B7B6CB',
  border: '#414058',
  primary: '#B7AFFE',
  primarySoft: '#302E53',
  warning: '#E3A473',
  warningSoft: '#3A291F',
  tab: '#1D1D2C',
  shadow: '#000000',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
