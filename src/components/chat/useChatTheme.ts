import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { createStyles, DARK_COLORS, LIGHT_COLORS } from './theme';

export function useChatTheme() {
  const isDark = useColorScheme() === 'dark';
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  const styles = useMemo(() => createStyles(colors), [colors]);
  return { isDark, colors, styles };
}

export type ChatStyles = ReturnType<typeof createStyles>;
