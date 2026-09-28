// Vista previa cifrada de las notificaciones ("Omar: ya llegué") sin que el servidor la pueda leer.
//
// Cada telefono tiene una "llave de vista previa" propia y se la manda a sus contactos por el canal cifrado.
// Al enviar un mensaje, el telefono cifra una vista previa corta con la llave del destinatario; el servidor solo
// la reenvia dentro de la notificacion. En el telefono que la recibe:
//  - iPhone: la extension nativa (targets/notification-service) la descifra antes de mostrar la notificacion
//  - Android: una tarea en segundo plano la descifra y muestra la notificacion (backgroundNotifications.ts)
// Cifrado: ChaCha20-Poly1305 (el mismo de CryptoKit en iOS). Formato: base64(nonce 12 bytes | cifrado | tag 16).
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import nacl from 'tweetnacl';
import { bytesToUtf8, fromB64, toB64, utf8Bytes } from './crypto/primitives';
import { log } from './log';

// Grupo del llavero compartido con la extension de iPhone (equipo de Apple + id de la app)
export const IOS_SHARED_KEYCHAIN_GROUP = 'RMX9T6ZVA9.com.mascorro55.chatapp.shared';
// La extension lee estos mismos nombres (ver targets/notification-service/NotificationService.swift)
const SERVICE = 'aeterna.preview';
const KEY_NAME = 'pnk';
const ENABLED_NAME = 'preview_on';

// Accesible despues del primer desbloqueo: las notificaciones llegan con el telefono bloqueado
function options(): SecureStore.SecureStoreOptions {
  return {
    keychainService: SERVICE,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    ...(Platform.OS === 'ios' ? { accessGroup: IOS_SHARED_KEYCHAIN_GROUP } : {}),
  };
}

async function getItem(name: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(name, options());
  } catch (e) {
    log('No se pudo leer del llavero compartido:', e);
    return null;
  }
}

async function setItem(name: string, value: string) {
  try {
    await SecureStore.setItemAsync(name, value, options());
  } catch (e) {
    log('No se pudo guardar en el llavero compartido:', e);
  }
}

export async function getDeviceKey(): Promise<Uint8Array | null> {
  const stored = await getItem(KEY_NAME);
  if (!stored) return null;
  const key = fromB64(stored);
  return key.length === 32 ? key : null;
}

export async function getOrCreateDeviceKey(): Promise<Uint8Array> {
  const existing = await getDeviceKey();
  if (existing) return existing;
  const key = nacl.randomBytes(32);
  await setItem(KEY_NAME, toB64(key));
  return key;
}

// Huella corta para saber si ya se le mando la llave actual a un contacto
export function keyFingerprint(key: Uint8Array): string {
  return toB64(nacl.hash(key).subarray(0, 12));
}

export async function resetDeviceKey() {
  try {
    await SecureStore.deleteItemAsync(KEY_NAME, options());
  } catch {
    // no existia
  }
}

export async function getPreviewsEnabled(): Promise<boolean> {
  return (await getItem(ENABLED_NAME)) !== 'off';
}

export async function setPreviewsEnabled(enabled: boolean) {
  await setItem(ENABLED_NAME, enabled ? 'on' : 'off');
}

export type Preview = { f: string; b: string }; // f: quien lo manda, b: texto

export function encryptPreview(key: Uint8Array, preview: Preview): string {
  const nonce = nacl.randomBytes(12);
  const sealed = chacha20poly1305(key, nonce).encrypt(utf8Bytes(JSON.stringify(preview)));
  const out = new Uint8Array(12 + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, 12);
  return toB64(out);
}

export function decryptPreview(key: Uint8Array, data: string): Preview | null {
  try {
    const bytes = fromB64(data);
    if (bytes.length < 12 + 16) return null;
    const plain = chacha20poly1305(key, bytes.subarray(0, 12)).decrypt(bytes.subarray(12));
    const parsed = JSON.parse(bytesToUtf8(plain));
    if (typeof parsed.f !== 'string' || typeof parsed.b !== 'string') return null;
    return { f: parsed.f.slice(0, 60), b: parsed.b.slice(0, 200) };
  } catch {
    return null;
  }
}

const MAX_PREVIEW_CHARS = 120;

// Texto de la vista previa. Los temporales y "ver una vez" no muestran contenido en la pantalla bloqueada.
export function previewText(p: { kind: string; body?: string; ttl?: number; selfDestruct?: boolean; viewOnce?: boolean; media?: unknown }): string {
  if (p.ttl || p.selfDestruct) return '⏱ Mensaje temporal';
  if (p.viewOnce) return '📷 Foto de ver una vez';
  switch (p.kind) {
    case 'image':
      return '📷 Foto';
    case 'video':
      return '🎬 Video';
    case 'voice':
      return '🎤 Nota de voz';
    case 'sticker':
      return p.media ? '🏷 Sticker' : (p.body ?? '').slice(0, MAX_PREVIEW_CHARS);
    default: {
      const body = (p.body ?? '').replace(/\s+/g, ' ').trim();
      return body.length > MAX_PREVIEW_CHARS ? body.slice(0, MAX_PREVIEW_CHARS) + '…' : body;
    }
  }
}
