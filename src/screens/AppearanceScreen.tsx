import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIconPicker } from '../components/chat/AppIconPicker';
import { ChatWallpaper } from '../components/chat/ChatWallpaper';
import { THEMES } from '../components/chat/theme';
import { useChatTheme } from '../components/chat/useChatTheme';
import { WallpaperPicker } from '../components/chat/WallpaperPicker';
import { setThemeId, setThemeMode, setWallpaper, ThemeMode, useAppearance } from '../lib/appearance';

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'auto', label: 'Automático' },
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
];

export function AppearanceScreen({ onClose }: { onClose: () => void }) {
  const { isDark, colors, styles } = useChatTheme();
  const appearance = useAppearance();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={onClose} style={styles.backTouchable}>
            <Text style={styles.backChevron}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.chatHeaderName}>APARIENCIA</Text>
        </View>
        <ScrollView contentContainerStyle={styles.screenBody}>
          <Text style={styles.infoSectionTitle}>VISTA PREVIA</Text>
          <View style={styles.previewBox}>
            <ChatWallpaper wallpaper={appearance.wallpaper} fallbackColor={colors.bg} style={{ padding: 12, justifyContent: 'flex-end' }}>
              <View style={{ alignItems: 'flex-start', marginBottom: 6 }}>
                <View style={[styles.bubble, styles.theirBubble]}>
                  <Text style={styles.theirText}>¿Cómo se ve el chat?</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View style={[styles.bubble, styles.myBubble]}>
                  <Text style={styles.myText}>¡Así se ve! 👌</Text>
                </View>
              </View>
            </ChatWallpaper>
          </View>

          <Text style={styles.infoSectionTitle}>TEMA</Text>
          {THEMES.map((theme) => {
            const palette = theme[isDark ? 'dark' : 'light'];
            const selected = appearance.themeId === theme.id;
            return (
              <TouchableOpacity key={theme.id} style={[styles.themeCard, selected && styles.themeCardActive]} onPress={() => setThemeId(theme.id)} activeOpacity={0.7}>
                <View style={styles.themeSwatches}>
                  {[palette.bg, palette.primary, palette.bubbleMine, palette.accent].map((c, i) => (
                    <View key={i} style={[styles.themeSwatch, { backgroundColor: c }]} />
                  ))}
                </View>
                <Text style={styles.themeName}>{theme.name}</Text>
                {selected && <Text style={{ color: colors.accent, fontSize: 18 }}>✓</Text>}
              </TouchableOpacity>
            );
          })}

          <Text style={styles.infoSectionTitle}>MODO</Text>
          <View style={styles.segmentRow}>
            {MODES.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={[styles.segment, appearance.mode === m.id && styles.segmentActive]}
                onPress={() => setThemeMode(m.id)}
                activeOpacity={0.7}
              >
                <Text style={[styles.segmentText, appearance.mode === m.id && styles.segmentTextActive]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.settingsHint}>Automático sigue el modo claro u oscuro de tu teléfono.</Text>

          <Text style={styles.infoSectionTitle}>ÍCONO DE LA APP</Text>
          <AppIconPicker styles={styles} colors={colors} />

          <Text style={styles.infoSectionTitle}>FONDO DE LOS CHATS</Text>
          <WallpaperPicker value={appearance.wallpaper} onChange={(w) => setWallpaper(null, w)} styles={styles} colors={colors} />
          <Text style={[styles.settingsHint, { marginTop: 10, marginBottom: 24 }]}>
            Es el fondo de todos los chats. Para ponerle uno distinto a un chat, toca el nombre del contacto arriba del chat.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
