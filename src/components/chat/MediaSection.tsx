import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import ImageViewing from 'react-native-image-viewing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { client } from '../../lib/client';
import { decryptToCache } from '../../lib/media';
import { ChatMessage } from '../../lib/types';
import { MediaTile } from './MediaViews';
import { Colors } from './theme';
import { ChatStyles } from './useChatTheme';

const FIRST_PAGE = 9;
const PAGE = 30;
const PER_ROW = 3;

// Todas las fotos y videos del chat (como "Multimedia" en WhatsApp), los mas nuevos primero.
// Se muestran de a poco: cada foto se descifra para dibujarla.
export function MediaSection({ peer, epoch, reloadKey, styles, colors, onGoToMessage }: {
  peer: string;
  epoch: number;
  reloadKey: unknown;
  styles: ChatStyles;
  colors: Colors;
  onGoToMessage: (id: string) => void;
}) {
  const [items, setItems] = useState<ChatMessage[] | null>(null);
  const [shownCount, setShownCount] = useState(FIRST_PAGE);
  const [viewer, setViewer] = useState<{ images: { uri: string }[]; index: number } | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client.listMedia(peer).then((list) => !cancelled && setItems(list));
    return () => {
      cancelled = true;
    };
  }, [peer, reloadKey]);

  // Al ir a segundo plano se borra lo descifrado: el visor se cierra
  useEffect(() => {
    setViewer(null);
  }, [epoch]);

  // Foto: visor deslizable con las fotos de alrededor. Video: se abre en el chat, donde se reproduce.
  const open = async (m: ChatMessage) => {
    if (m.kind === 'video') {
      onGoToMessage(m.id);
      return;
    }
    const photos = (items ?? []).filter((p) => p.kind === 'image' && p.downloadState === 'done' && p.mediaFile && p.media);
    const pos = photos.findIndex((p) => p.id === m.id);
    if (pos < 0) {
      onGoToMessage(m.id);
      return;
    }
    // En el visor van del mas viejo al mas nuevo, como en el chat
    const around = photos.slice(Math.max(0, pos - 15), pos + 16).reverse();
    const uris = await Promise.all(around.map((p) => decryptToCache(p.id, 'image', p.mediaFile!, p.media!).catch(() => null)));
    const images: { uri: string }[] = [];
    let index = 0;
    uris.forEach((u, i) => {
      if (!u) return;
      if (around[i].id === m.id) index = images.length;
      images.push({ uri: u });
    });
    if (images.length === 0) return;
    setViewerIndex(index);
    setViewer({ images, index });
  };

  const shown = items ? items.slice(0, shownCount) : [];

  return (
    <>
      <Text style={styles.infoSectionTitle}>FOTOS Y VIDEOS{items && items.length > 0 ? ` (${items.length})` : ''}</Text>
      {items === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
      ) : items.length === 0 ? (
        <Text style={styles.settingsHint}>Aquí aparecen las fotos y videos que se manden en este chat.</Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {shown.map((m, i) => (
              <MediaTile
                key={m.id}
                message={m}
                epoch={epoch}
                onPress={() => open(m)}
                style={{ width: '32%', aspectRatio: 1, borderRadius: 8, marginRight: i % PER_ROW === PER_ROW - 1 ? 0 : '2%', marginBottom: 6 }}
              />
            ))}
          </View>
          {items.length > shownCount ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setShownCount((n) => n + PAGE)} activeOpacity={0.8}>
              <Text style={styles.secondaryButtonText}>{shownCount === FIRST_PAGE ? `VER TODOS (${items.length})` : `VER MÁS (${items.length - shownCount})`}</Text>
            </TouchableOpacity>
          ) : shownCount > FIRST_PAGE ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setShownCount(FIRST_PAGE)} activeOpacity={0.8}>
              <Text style={styles.secondaryButtonText}>VER MENOS</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
      <ImageViewing
        images={viewer?.images ?? []}
        imageIndex={viewer?.index ?? 0}
        visible={!!viewer}
        onRequestClose={() => setViewer(null)}
        onImageIndexChange={setViewerIndex}
        HeaderComponent={() => (
          <SafeAreaView edges={['top']} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
              {viewer && viewer.images.length > 1 ? `${viewerIndex + 1} / ${viewer.images.length}` : ''}
            </Text>
            <TouchableOpacity onPress={() => setViewer(null)} hitSlop={12} activeOpacity={0.7}>
              <Text style={{ color: '#fff', fontSize: 26 }}>✕</Text>
            </TouchableOpacity>
          </SafeAreaView>
        )}
      />
    </>
  );
}
