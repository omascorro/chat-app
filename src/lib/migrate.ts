// Pasa el historial de la version anterior (texto plano en AsyncStorage y archivos sin cifrar) a la base cifrada
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Store } from './db';
import { deleteLegacyKeys } from './keystore';
import { log } from './log';
import { fileExists, importPlainFile } from './media';
import { ChatMessage, MediaKind } from './types';

type LegacyMessage = {
  id: string;
  text: string;
  kind: 'text' | 'image' | 'sticker' | 'video' | 'voice';
  sentByMe: boolean;
  timestamp: number;
  status?: 'sent' | 'read' | 'failed';
  duration?: number;
  selfDestruct?: boolean;
};

export async function migrateLegacyData(store: Store, username: string) {
  if (await store.getKv('migrated_v1')) return;

  const storageKey = `messages_${username}`;
  let conversations: Record<string, LegacyMessage[]> = {};
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw) conversations = JSON.parse(raw);
  } catch (e) {
    log('No se pudo leer el historial anterior:', e);
  }

  let migrated = 0;
  for (const [peer, messages] of Object.entries(conversations)) {
    for (const old of messages || []) {
      if (old.selfDestruct) continue; // debieron borrarse; se descartan
      const base: ChatMessage = {
        id: old.id,
        peer,
        fromMe: old.sentByMe,
        kind: old.kind,
        body: '',
        media: null,
        mediaFile: null,
        downloadState: 'none',
        duration: old.duration ?? null,
        sentAt: old.timestamp,
        status: old.status === 'read' ? 'read' : old.status === 'failed' ? 'failed' : 'sent',
        selfDestruct: false,
        expiresAt: null,
        replyTo: null,
        editedAt: null,
        deleted: false,
        reactions: {},
        readByMe: true,
      };
      if (old.kind === 'text' || old.kind === 'sticker') {
        base.body = old.text;
      } else if (old.text && (await fileExists(old.text))) {
        try {
          const { media, mediaFile } = await importPlainFile(old.id, old.text, old.kind as MediaKind, true);
          base.media = media;
          base.mediaFile = mediaFile;
          base.downloadState = 'done';
        } catch (e) {
          log('No se pudo migrar un archivo:', e);
        }
      }
      if (await store.insertMessage(base)) migrated++;
    }
  }

  await deleteLegacyKeys(username, Object.keys(conversations));
  await AsyncStorage.removeItem(storageKey);
  await store.setKv('migrated_v1', String(Date.now()));
  if (migrated > 0) log(`Migrados ${migrated} mensajes del historial anterior`);
}
