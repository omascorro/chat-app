// Respaldo del historial cifrado con una contraseña (PBKDF2-SHA512 + XSalsa20-Poly1305).
// No incluye las llaves de identidad: al restaurar en otro telefono se crea una identidad nueva, como en Signal.
import * as FileSystem from 'expo-file-system/legacy';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import nacl from 'tweetnacl';
import { bytesToUtf8, fromB64, toB64, utf8Bytes } from './crypto/primitives';
import { Store } from './db';
import { deleteMediaFile, fileExists, fileSize, readMediaFileBase64, writeMediaFileBase64 } from './media';
import { ChatMessage } from './types';
import { cleanBackupMessage, MAX_ENCRYPTED_BYTES } from './validate';

const FORMAT = 'aeterna-backup';
// 210 000 (recomendacion actual de OWASP para PBKDF2-SHA512): adivinar la contraseña de un respaldo robado cuesta
// 7 veces mas que con los 30 000 de antes. Los respaldos viejos guardan su numero y se siguen abriendo.
const ITERATIONS = 210_000;
const MAX_ITERATIONS = 5_000_000; // un archivo alterado no puede dejar la app calculando para siempre
export const BACKUP_PASSWORD_MIN_LENGTH = 10;

type BackupContent = {
  username: string;
  exportedAt: number;
  messages: ChatMessage[];
  media: Record<string, string>; // id del mensaje -> archivo cifrado en base64
};

type BackupFile = { format: string; v: 1; salt: string; iterations: number; nonce: string; data: string };

// Version asincrona: cede el control cada pocos milisegundos para que la pantalla no se congele mientras calcula
function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > MAX_ITERATIONS) throw new Error('Ese archivo no es un respaldo de Aeterna');
  return pbkdf2Async(sha512, utf8Bytes(password), salt, { c: iterations, dkLen: 32, asyncTick: 20 });
}

export async function exportBackup(store: Store, username: string, password: string, includeMedia: boolean): Promise<string> {
  if (password.length < BACKUP_PASSWORD_MIN_LENGTH) throw new Error(`La contraseña del respaldo debe tener al menos ${BACKUP_PASSWORD_MIN_LENGTH} caracteres`);
  // Los mensajes temporales y las fotos de "ver una vez" nunca se respaldan
  const messages = (await store.getAllMessages()).filter((m) => !m.selfDestruct && !m.deleted && !m.viewOnce);
  const media: Record<string, string> = {};
  for (const m of messages) {
    if (includeMedia && m.mediaFile && (await fileExists(m.mediaFile))) media[m.id] = await readMediaFileBase64(m.mediaFile);
  }
  const exported = messages.map((m) => ({ ...m, mediaFile: null, downloadState: m.media && !media[m.id] ? 'none' : m.downloadState }) as ChatMessage);
  const content: BackupContent = { username, exportedAt: Date.now(), messages: exported, media };

  const salt = nacl.randomBytes(16);
  const nonce = nacl.randomBytes(24);
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = nacl.secretbox(utf8Bytes(JSON.stringify(content)), nonce, key);
  const file: BackupFile = { format: FORMAT, v: 1, salt: toB64(salt), iterations: ITERATIONS, nonce: toB64(nonce), data: toB64(data) };

  const date = new Date().toISOString().slice(0, 10);
  const uri = `${FileSystem.cacheDirectory}aeterna-respaldo-${date}.aeb`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(file));
  return uri;
}

// El archivo entero se lee en memoria (y el contenido descifrado tambien): mas que esto no lo aguanta un telefono.
// Un respaldo legitimo con muchas fotos y videos puede pesar cientos de MB; se avisa antes de intentar abrirlo.
export const MAX_BACKUP_BYTES = 400 * 1024 * 1024;
const MAX_BACKUP_MESSAGES = 2_000_000;
const notABackup = () => new Error('Ese archivo no es un respaldo de Aeterna');

function b64Bytes(value: unknown, length?: number): Uint8Array {
  if (typeof value !== 'string') throw notABackup();
  let bytes: Uint8Array;
  try {
    bytes = fromB64(value);
  } catch {
    throw notABackup();
  }
  if (length !== undefined && bytes.length !== length) throw notABackup();
  return bytes;
}

// Devuelve cuantos mensajes se restauraron y cuantos se saltaron por venir mal formados.
// Se revisa el tamaño antes de leer y la estructura antes de usar nada. Cada mensaje se valida como si llegara del
// otro telefono. Los que ya estan en este telefono no se tocan (ni su archivo): la copia del respaldo va a un
// archivo nuevo que se borra si el mensaje ya existia o si algo falla.
export async function importBackup(store: Store, uri: string, password: string): Promise<{ restored: number; skipped: number }> {
  const bytes = await fileSize(uri);
  if (bytes > MAX_BACKUP_BYTES) throw new Error(`El respaldo pesa ${Math.round(bytes / 1048576)} MB y el máximo que se puede abrir es ${Math.round(MAX_BACKUP_BYTES / 1048576)} MB.`);
  let file: Partial<BackupFile>;
  try {
    file = JSON.parse(await FileSystem.readAsStringAsync(uri));
  } catch {
    throw notABackup();
  }
  if (!file || typeof file !== 'object' || file.format !== FORMAT || file.v !== 1 || typeof file.iterations !== 'number') throw notABackup();
  const salt = b64Bytes(file.salt);
  if (salt.length < 16 || salt.length > 64) throw notABackup();
  const nonce = b64Bytes(file.nonce, nacl.secretbox.nonceLength);
  const data = b64Bytes(file.data);

  const key = await deriveKey(password, salt, file.iterations);
  const plain = nacl.secretbox.open(data, nonce, key);
  if (!plain) throw new Error('Contraseña incorrecta o respaldo dañado');
  let content: Partial<BackupContent>;
  try {
    content = JSON.parse(bytesToUtf8(plain));
  } catch {
    throw new Error('El respaldo está dañado');
  }
  if (!content || !Array.isArray(content.messages) || content.messages.length > MAX_BACKUP_MESSAGES) throw new Error('El respaldo está dañado');
  const mediaMap = content.media && typeof content.media === 'object' ? content.media : {};

  let restored = 0;
  let skipped = 0;
  for (const raw of content.messages) {
    const m = cleanBackupMessage(raw);
    if (!m) {
      skipped++;
      continue;
    }
    // Ya esta en este telefono (respaldo restaurado dos veces, o el mensaje nunca se borro): se deja como esta
    if (await store.getMessage(m.id)) continue;
    let mediaFile: string | null = null;
    const encoded = Object.prototype.hasOwnProperty.call(mediaMap, m.id) ? (mediaMap as Record<string, unknown>)[m.id] : undefined;
    if (m.media && typeof encoded === 'string' && encoded.length <= MAX_MEDIA_BASE64) {
      // Solo se guarda si de verdad abre con la llave del mensaje
      const cipher = fromB64Safe(encoded);
      if (cipher && nacl.secretbox.open(cipher, fromB64(m.media.nonce), fromB64(m.media.key))) mediaFile = await writeMediaFileBase64(encoded);
    }
    try {
      const inserted = await store.insertMessage({ ...m, mediaFile, downloadState: mediaFile ? 'done' : 'none' });
      if (inserted) restored++;
      else await deleteMediaFile(mediaFile);
    } catch (e) {
      await deleteMediaFile(mediaFile);
      throw e;
    }
  }
  return { restored, skipped };
}

// Base64 de un archivo cifrado de 50 MB (lo maximo que acepta el servidor) con margen
const MAX_MEDIA_BASE64 = Math.ceil((MAX_ENCRYPTED_BYTES + 1024) / 3) * 4;

function fromB64Safe(value: string): Uint8Array | null {
  try {
    return fromB64(value);
  } catch {
    return null;
  }
}
