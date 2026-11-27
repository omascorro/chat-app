// Vista previa cifrada de las notificaciones ("Omar: ya llegué") sin que el servidor la pueda leer.
//
// Version 2 (2026-11): cada telefono crea una llave de vista previa DISTINTA para cada contacto, con un id corto, y se
// la manda solo a ese contacto por el canal cifrado (payload "nk2"). En el llavero se guarda id -> {llave, contacto}.
// Al enviar un mensaje, el telefono cifra la vista previa con la llave que le dio el destinatario y pone el id
// adelante; el servidor solo la reenvia dentro de la notificacion. El que la recibe busca la llave por el id y el
// nombre que muestra sale de SU llavero, no del contenido: un contacto no puede hacerse pasar por otro, ni leer las
// vistas previas que le mandan los demas (antes habia una sola llave compartida con todos los contactos).
//  - iPhone: la extension nativa (targets/notification-service) la descifra antes de mostrar la notificacion
//  - Android: una tarea en segundo plano la descifra y muestra la notificacion (backgroundNotifications.ts)
// Cifrado: ChaCha20-Poly1305 (el mismo de CryptoKit en iOS) con el id como dato asociado.
// Formato v2: base64(0x02 | id 8 bytes | nonce 12 | cifrado | tag 16), contenido JSON {"b": texto}.
//
// Retiro de la version 1 (llave unica "pnk"): al abrir la app nueva se borra "pnk" del llavero y las llaves viejas de
// los contactos; desde ahi lo que llegue en formato viejo se muestra con el aviso generico. Una llave v2 se retira
// (se borra del llavero y se crea otra) al aceptar una identidad nueva del contacto, al reiniciar la sesion, al
// quitar el contacto y con el boton de panico.
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

// Llave unica de la version 1: ya no se crea; solo se lee (pruebas) y se borra al pasar a la version 2
export async function getDeviceKey(): Promise<Uint8Array | null> {
  const stored = await getItem(KEY_NAME);
  if (!stored) return null;
  const key = fromB64(stored);
  return key.length === 32 ? key : null;
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

// ---- version 2: una llave por contacto ----

const V2 = 0x02;
const KID_BYTES = 8;
export const KID_REGEX = /^[0-9a-f]{16}$/;
const v2ItemName = (kid: string) => `pnk2_${kid}`;
const v2Aad = (kid: string) => utf8Bytes(`aeterna-preview-v2:${kid}`);

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function unhex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Llave que este telefono le da a `peer` para que le cifre sus vistas previas. Queda en el llavero compartido con la
// extension de iPhone junto con el nombre del contacto (asi el titulo de la notificacion no depende de lo que mande).
export async function createPeerPreviewKey(peer: string): Promise<{ kid: string; key: Uint8Array } | null> {
  const kid = hex(nacl.randomBytes(KID_BYTES));
  const key = nacl.randomBytes(32);
  try {
    await SecureStore.setItemAsync(v2ItemName(kid), JSON.stringify({ k: toB64(key), f: peer }), options());
    return { kid, key };
  } catch (e) {
    log('No se pudo guardar la llave de vista previa:', e);
    return null;
  }
}

export async function hasPeerPreviewKey(kid: string): Promise<boolean> {
  return KID_REGEX.test(kid) && (await getItem(v2ItemName(kid))) !== null;
}

export async function deletePeerPreviewKey(kid: string) {
  if (!KID_REGEX.test(kid)) return;
  try {
    await SecureStore.deleteItemAsync(v2ItemName(kid), options());
  } catch {
    // no existia
  }
}

export function encryptPreviewV2(kid: string, key: Uint8Array, text: string): string {
  const nonce = nacl.randomBytes(12);
  const sealed = chacha20poly1305(key, nonce, v2Aad(kid)).encrypt(utf8Bytes(JSON.stringify({ b: text })));
  const out = new Uint8Array(1 + KID_BYTES + 12 + sealed.length);
  out[0] = V2;
  out.set(unhex(kid), 1);
  out.set(nonce, 1 + KID_BYTES);
  out.set(sealed, 1 + KID_BYTES + 12);
  return toB64(out);
}

// Lo que muestra la notificacion, o null para el aviso generico (formato viejo, llave retirada o contenido alterado)
export async function openPreview(data: string): Promise<Preview | null> {
  try {
    const bytes = fromB64(data);
    if (bytes.length < 1 + KID_BYTES + 12 + 16 || bytes[0] !== V2) return null;
    const kid = hex(bytes.subarray(1, 1 + KID_BYTES));
    const stored = await getItem(v2ItemName(kid));
    if (!stored) return null;
    const entry = JSON.parse(stored);
    const key = typeof entry.k === 'string' ? fromB64(entry.k) : null;
    if (!key || key.length !== 32 || typeof entry.f !== 'string') return null;
    const nonce = bytes.subarray(1 + KID_BYTES, 1 + KID_BYTES + 12);
    const plain = chacha20poly1305(key, nonce, v2Aad(kid)).decrypt(bytes.subarray(1 + KID_BYTES + 12));
    const parsed = JSON.parse(bytesToUtf8(plain));
    if (typeof parsed.b !== 'string') return null;
    return { f: entry.f.slice(0, 60), b: parsed.b.slice(0, 200) };
  } catch {
    return null;
  }
}

const MAX_PREVIEW_CHARS = 120;

// Texto de la vista previa. Los temporales y "ver una vez" no muestran contenido en la pantalla bloqueada.
export function previewText(p: { kind: string; body?: string; ttl?: number; selfDestruct?: boolean; viewOnce?: boolean; media?: unknown }): string {
  if (p.ttl || p.selfDestruct) return '⏱ Mensaje temporal';
  if (p.viewOnce) return '📷 Foto de ver una vez';
  const caption = (p.body ?? '').replace(/\s+/g, ' ').trim();
  const withCaption = (label: string) => (caption ? `${label.split(' ')[0]} ${caption.slice(0, MAX_PREVIEW_CHARS)}` : label);
  switch (p.kind) {
    case 'image':
      return withCaption('📷 Foto');
    case 'video':
      return withCaption('🎬 Video');
    case 'voice':
      return '🎤 Nota de voz';
    case 'file':
      return withCaption('📄 Documento');
    case 'sticker':
      return p.media ? '🏷 Sticker' : (p.body ?? '').slice(0, MAX_PREVIEW_CHARS);
    default: {
      const body = (p.body ?? '').replace(/\s+/g, ' ').trim();
      return body.length > MAX_PREVIEW_CHARS ? body.slice(0, MAX_PREVIEW_CHARS) + '…' : body;
    }
  }
}
