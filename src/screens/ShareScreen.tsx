// Cuando compartes una captura, foto o video desde otra app (o justo despues de sacar un pantallazo) y eliges Aeterna:
// aqui escoges a quien mandarlo. Las fotos pasan por lo mismo que las del chat (sin EXIF/GPS) y se cifran antes de salir.
import { File, Paths } from 'expo-file-system';
import { ResolvedSharePayload } from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/chat/Avatar';
import { useChatTheme } from '../components/chat/useChatTheme';
import { client, ClientState } from '../lib/client';
import { reencodeImage } from '../lib/imageSafety';
import { log } from '../lib/log';
import { deleteFile } from '../lib/media';
import { MediaKind } from '../lib/types';

export function isSendable(p: ResolvedSharePayload): boolean {
  return (p.contentType === 'image' || p.contentType === 'video') && !!p.contentUri;
}

// Copia a la carpeta temporal de la app (en Android llega como content://, en iPhone en la carpeta compartida)
function copyToCache(uri: string, extension: string): string {
  const dest = new File(Paths.cache, `compartido-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  new File(uri).copy(dest);
  return dest.uri;
}

async function prepare(p: ResolvedSharePayload): Promise<{ uri: string; kind: MediaKind } | null> {
  const source = p.contentUri!;
  if (p.contentType === 'video') return { uri: copyToCache(source, 'mp4'), kind: 'video' };
  // Foto: se recodifica (quita ubicacion y datos de la camara); si no se puede leer directo, primero se copia
  let clean = await reencodeImage(source);
  if (!clean) {
    const copy = copyToCache(source, (p.originalName?.split('.').pop() || 'jpg').toLowerCase());
    try {
      clean = await reencodeImage(copy);
    } finally {
      await deleteFile(copy);
    }
  }
  return clean ? { uri: clean, kind: 'image' } : null;
}

// La copia que dejo el sistema para la app (solo se puede borrar la de la carpeta compartida del iPhone)
function forgetOriginal(uri: string) {
  if (!uri.startsWith('file://')) return;
  try {
    new File(uri).delete();
  } catch {
    // no es nuestra o ya no existe
  }
}

export function ShareScreen({ state, payloads, onDone }: { state: ClientState; payloads: ResolvedSharePayload[]; onDone: () => void }) {
  const { isDark, colors, styles } = useChatTheme();
  const [sending, setSending] = useState<string | null>(null);
  const items = payloads.filter(isSendable);

  const sendTo = async (peer: string) => {
    setSending(peer);
    let failed = 0;
    for (const p of items) {
      try {
        const prepared = await prepare(p);
        if (!prepared) {
          failed++;
          continue;
        }
        await client.sendMedia(peer, prepared.uri, prepared.kind);
      } catch (e) {
        log('No se pudo mandar lo compartido:', e);
        failed++;
      } finally {
        forgetOriginal(p.contentUri!);
      }
    }
    onDone();
    await client.openConversation(peer);
    if (failed > 0) {
      Alert.alert(
        failed === items.length ? 'No se pudo enviar' : 'Algunas no se enviaron',
        'Por seguridad no se mandan las fotos a las que no se les pudieron quitar sus datos ocultos (como la ubicación).',
      );
    }
  };

  const cancel = () => {
    for (const p of items) forgetOriginal(p.contentUri!);
    onDone();
  };

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topRow}>
          <View style={[styles.topBox, { paddingLeft: 14 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.topName} numberOfLines={1}>Enviar a…</Text>
              <Text style={styles.topSub} numberOfLines={1}>
                {items.length === 1 ? (items[0].contentType === 'video' ? '1 video' : '1 foto') : `${items.length} archivos`} · cifrado
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={cancel} style={styles.topRoundButton} disabled={!!sending} activeOpacity={0.7}>
            <Text style={[styles.topRoundIcon, { color: colors.danger }]}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
          {items.map((p, i) =>
            p.contentType === 'image' ? (
              <Image key={i} source={{ uri: p.contentUri! }} style={{ width: 84, height: 84, borderRadius: 14, backgroundColor: colors.card }} />
            ) : (
              <View key={i} style={{ width: 84, height: 84, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 30 }}>🎬</Text>
              </View>
            ),
          )}
        </ScrollView>

        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>SOLO SE PUEDEN ENVIAR FOTOS Y VIDEOS</Text>
          </View>
        ) : (
          <FlatList
            data={state.contacts}
            keyExtractor={(item) => item.username}
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32 }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>TODAVÍA NO TIENES CONTACTOS</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.contactCard} onPress={() => sendTo(item.username)} disabled={!!sending} activeOpacity={0.7}>
                <Avatar name={item.username} size={48} photoBase64={item.profilePicture} round />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={styles.contactName} numberOfLines={1}>{item.username}</Text>
                  <Text style={styles.contactSub} numberOfLines={1}>{item.verified ? '✔ Verificado' : 'Toca para enviar'}</Text>
                </View>
                {sending === item.username && <ActivityIndicator color={colors.accent} />}
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    </>
  );
}
