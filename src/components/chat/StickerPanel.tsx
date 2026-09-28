import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Text, TouchableOpacity, View } from 'react-native';
import { client } from '../../lib/client';
import { cutOutSubject } from '../../lib/cutout';
import { Colors } from './theme';
import { ChatStyles } from './useChatTheme';

type Sticker = { id: string; uri: string };

// Panel "Mis stickers": tocar uno lo manda; mantenerlo presionado lo quita de la coleccion
export function StickerPanel({ epoch, onSend, styles, colors }: {
  epoch: number;
  onSend: (stickerId: string) => void;
  styles: ChatStyles;
  colors: Colors;
}) {
  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    client.listStickers().then(setStickers).catch(() => setStickers([]));
  }, []);

  // epoch cambia cuando se borra la carpeta temporal (al volver del segundo plano)
  useEffect(load, [load, epoch]);

  const addFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, allowsMultipleSelection: true, selectionLimit: 10 });
    if (result.canceled || !result.assets?.length) return;
    const assets = result.assets;
    Alert.alert(
      assets.length > 1 ? `Crear ${assets.length} stickers` : 'Crear sticker',
      '¿Recortar automáticamente a la persona u objeto principal, como en WhatsApp? Se hace dentro de tu teléfono.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Usar completa', onPress: () => addAssets(assets, false) },
        { text: '✂ Recortar', onPress: () => addAssets(assets, true) },
      ],
    );
  };

  const addAssets = async (assets: ImagePicker.ImagePickerAsset[], cut: boolean) => {
    setAdding(true);
    let failedCut: string | null = null;
    try {
      for (const asset of assets) {
        if (cut) {
          const cutout = await cutOutSubject(asset.uri);
          if ('uri' in cutout) {
            await client.addStickerFromImage(cutout.uri);
            continue;
          }
          failedCut = cutout.error;
        }
        // Sin recorte (o si no se pudo recortar): la imagen completa
        await client.addStickerFromImage(asset.uri, asset.width, asset.height);
      }
      load();
      if (failedCut) Alert.alert('Algunas se agregaron sin recortar', failedCut);
    } catch (e) {
      Alert.alert('No se pudo agregar', String((e as Error)?.message ?? e));
    } finally {
      setAdding(false);
    }
  };

  const confirmDelete = (sticker: Sticker) => {
    Alert.alert('Quitar sticker', '¿Quitarlo de tus stickers? Los que ya mandaste no se borran.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Quitar', style: 'destructive', onPress: async () => { await client.deleteSticker(sticker.id); load(); } },
    ]);
  };

  const data: (Sticker | 'add')[] = ['add', ...(stickers ?? [])];

  return (
    <View style={styles.stickerPanel}>
      {stickers === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={data}
          numColumns={4}
          keyExtractor={(item) => (item === 'add' ? 'add' : item.id)}
          contentContainerStyle={{ padding: 8 }}
          ListFooterComponent={
            stickers.length === 0 ? (
              <Text style={[styles.settingsHint, { textAlign: 'center', marginTop: 8, paddingHorizontal: 16 }]}>
                Toca ＋ para crear stickers con fotos o imágenes de tu galería. Las imágenes con fondo transparente (PNG) se ven recortadas. También puedes guardar los que te manden manteniéndolos presionados.
              </Text>
            ) : null
          }
          renderItem={({ item }) =>
            item === 'add' ? (
              <TouchableOpacity style={[styles.stickerCell, styles.stickerAddCell]} onPress={addFromGallery} disabled={adding} activeOpacity={0.7}>
                {adding ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.stickerAddText}>＋</Text>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.stickerCell} onPress={() => onSend(item.id)} onLongPress={() => confirmDelete(item)} activeOpacity={0.6}>
                <Image source={{ uri: item.uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
              </TouchableOpacity>
            )
          }
        />
      )}
    </View>
  );
}
