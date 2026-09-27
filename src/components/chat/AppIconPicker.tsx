import { getAppIconName, setAlternateAppIcon, supportsAlternateIcons } from 'expo-alternate-app-icons';
import { useState } from 'react';
import { Alert, Image, Platform, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from './theme';
import { ChatStyles } from './useChatTheme';

// name null = icono original. Los nombres coinciden con los del plugin en app.json.
const ICONS: { name: string | null; label: string; image: number; disguise?: boolean }[] = [
  { name: null, label: 'Militar', image: require('../../../assets/images/icon.png') },
  { name: 'Clasico', label: 'Clásico', image: require('../../../assets/icons/Clasico-ios.png') },
  { name: 'Oceano', label: 'Océano', image: require('../../../assets/icons/Oceano-ios.png') },
  { name: 'Grafito', label: 'Grafito', image: require('../../../assets/icons/Grafito-ios.png') },
  { name: 'Rosa', label: 'Rosa', image: require('../../../assets/icons/Rosa-ios.png') },
  { name: 'Notas', label: 'Notas', image: require('../../../assets/icons/Notas-ios.png'), disguise: true },
  { name: 'Clima', label: 'Clima', image: require('../../../assets/icons/Clima-ios.png'), disguise: true },
  { name: 'Calculadora', label: 'Calculadora', image: require('../../../assets/icons/Calculadora-ios.png'), disguise: true },
];

export function AppIconPicker({ styles, colors }: { styles: ChatStyles; colors: Colors }) {
  const [current, setCurrent] = useState<string | null>(() => {
    try {
      return getAppIconName();
    } catch {
      return null;
    }
  });

  if (!supportsAlternateIcons) {
    return <Text style={styles.settingsHint}>Este teléfono no permite cambiar el ícono de la app.</Text>;
  }

  const apply = async (name: string | null) => {
    if (name === current) return;
    const change = async () => {
      try {
        await setAlternateAppIcon(name);
        setCurrent(name);
      } catch (e) {
        Alert.alert('No se pudo cambiar el ícono', String((e as Error)?.message ?? e));
      }
    };
    // En Android el sistema cierra la app al cambiar el icono; se avisa antes
    if (Platform.OS === 'android') {
      Alert.alert('Cambiar ícono', 'Android va a cerrar la app para aplicar el ícono nuevo. Vuelve a abrirla desde el ícono nuevo.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cambiar', onPress: change },
      ]);
    } else {
      await change();
    }
  };

  const tile = (icon: (typeof ICONS)[number]) => {
    const selected = icon.name === current;
    return (
      <TouchableOpacity key={icon.label} style={styles.iconTile} onPress={() => apply(icon.name)} activeOpacity={0.7}>
        <Image source={icon.image} style={[styles.iconImage, selected && { borderColor: colors.accent, borderWidth: 3 }]} />
        <Text style={[styles.iconLabel, selected && { color: colors.accent }]} numberOfLines={1}>{icon.label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <View style={styles.iconGrid}>{ICONS.filter((i) => !i.disguise).map(tile)}</View>
      <Text style={[styles.settingsHint, { marginTop: 4, marginBottom: 8 }]}>
        Disfraz: la app parece otra cosa en tu pantalla de inicio. El nombre debajo del ícono sigue diciendo "Aeterna".
      </Text>
      <View style={styles.iconGrid}>{ICONS.filter((i) => i.disguise).map(tile)}</View>
    </View>
  );
}
