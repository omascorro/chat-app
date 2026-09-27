import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useAppearance } from '../../lib/appearance';
import { createStyles, getTheme } from './theme';

export function useChatTheme() {
  const system = useColorScheme();
  const { themeId, mode } = useAppearance();
  const isDark = mode === 'auto' ? system === 'dark' : mode === 'dark';
  const colors = getTheme(themeId)[isDark ? 'dark' : 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  return { isDark, colors, styles };
}

export type ChatStyles = ReturnType<typeof createStyles>;
