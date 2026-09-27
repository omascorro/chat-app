import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Text, TouchableOpacity, View } from 'react-native';
import { importWallpaperImage, Wallpaper, WALLPAPER_COLORS } from '../../lib/appearance';
import { Colors } from './theme';
import { ChatStyles } from './useChatTheme';

const DIM_LEVELS = [
  { label: 'Nada', value: 0 },
  { label: 'Poco', value: 0.2 },
  { label: 'Medio', value: 0.4 },
  { label: 'Mucho', value: 0.6 },
];

// value null = "usar el fondo general" (solo cuando allowInherit)
export function WallpaperPicker({ value, allowInherit, onChange, styles, colors }: {
  value: Wallpaper | null;
  allowInherit?: boolean;
  onChange: (w: Wallpaper | null) => void;
  styles: ChatStyles;
  colors: Colors;
}) {
  const [busy, setBusy] = useState(false);

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.uri) return;
    setBusy(true);
    try {
      const uri = await importWallpaperImage(asset.uri);
      onChange({ type: 'image', uri, dim: 0.2 });
    } catch (e) {
      Alert.alert('No se pudo usar la foto', String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const option = (label: string, selected: boolean, onPress: () => void) => (
    <TouchableOpacity style={[styles.segment, selected && styles.segmentActive]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <View style={styles.segmentRow}>
        {allowInherit && option('Usar el general', value === null, () => onChange(null))}
        {option('Sin fondo', value?.type === 'none', () => onChange({ type: 'none' }))}
      </View>

      <View style={styles.wallpaperGrid}>
        {WALLPAPER_COLORS.map((color) => {
          const selected = value?.type === 'color' && value.color === color;
          return (
            <TouchableOpacity
              key={color}
              onPress={() => onChange({ type: 'color', color })}
              style={[styles.wallpaperSwatch, { backgroundColor: color }, selected && { borderColor: colors.accent, borderWidth: 3 }]}
              activeOpacity={0.7}
            />
          );
        })}
      </View>

      <TouchableOpacity style={styles.secondaryButton} onPress={pickPhoto} disabled={busy} activeOpacity={0.8}>
        {busy ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.secondaryButtonText}>🖼  ELEGIR FOTO DE LA GALERÍA</Text>}
      </TouchableOpacity>

      {value?.type === 'image' && (
        <View style={{ marginTop: 12 }}>
          <Image source={{ uri: value.uri }} style={styles.wallpaperPreviewImage} resizeMode="cover" />
          <Text style={[styles.settingsHint, { marginTop: 10, marginBottom: 6 }]}>Oscurecer la foto para que los mensajes se lean mejor:</Text>
          <View style={styles.segmentRow}>
            {DIM_LEVELS.map((d) => option(d.label, Math.abs(value.dim - d.value) < 0.01, () => onChange({ ...value, dim: d.value })))}
          </View>
        </View>
      )}
    </View>
  );
}
