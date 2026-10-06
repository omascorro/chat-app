// Respaldo del historial cifrado con una contraseña (PBKDF2-SHA512 + XSalsa20-Poly1305).
// No incluye las llaves de identidad: al restaurar en otro telefono se crea una identidad nueva, como en Signal.
import * as FileSystem from 'expo-file-system/legacy';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import nacl from 'tweetnacl';
import { bytesToUtf8, fromB64, toB64, utf8Bytes } from './crypto/primitives';
import { Store } from './db';
import { fileExists, readMediaFileBase64, writeMediaFileBase64 } from './media';
import { ChatMessage } from './types';

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

export async function importBackup(store: Store, uri: string, password: string): Promise<number> {
  let file: BackupFile;
  try {
    file = JSON.parse(await FileSystem.readAsStringAsync(uri));
  } catch {
    throw new Error('Ese archivo no es un respaldo de Aeterna');
  }
  if (file.format !== FORMAT || file.v !== 1) throw new Error('Ese archivo no es un respaldo de Aeterna');

  const key = await deriveKey(password, fromB64(file.salt), file.iterations);
  const plain = nacl.secretbox.open(fromB64(file.data), fromB64(file.nonce), key);
  if (!plain) throw new Error('Contraseña incorrecta o respaldo dañado');
  const content: BackupContent = JSON.parse(bytesToUtf8(plain));

  let restored = 0;
  for (const m of content.messages) {
    let mediaFile: string | null = null;
    if (content.media[m.id]) mediaFile = await writeMediaFileBase64(m.id, content.media[m.id]);
    const status = m.status === 'pending' ? 'failed' : m.status;
    const downloadState = mediaFile ? 'done' : m.media ? 'none' : m.downloadState;
    if (await store.insertMessage({ ...m, mediaFile, status, downloadState, readByMe: true })) restored++;
  }
  return restored;
}
