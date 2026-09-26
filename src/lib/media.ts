// Cada archivo se cifra con su propia llave (como los adjuntos de Signal). La llave viaja dentro del mensaje cifrado,
// asi que el servidor y Supabase solo guardan bytes ilegibles. En el telefono se guarda la misma copia cifrada y solo
// se descifra a una carpeta temporal mientras se ve; esa carpeta se borra al salir de la app.
import * as FileSystem from 'expo-file-system/legacy';
import nacl from 'tweetnacl';
import { SERVER_HTTP_URL } from './config';
import { fromB64, randomHex, toB64 } from './crypto/primitives';
import { MediaKind, MediaRef } from './types';

export type MediaAuth = { username: string; token: string };

function authHeaders(auth: MediaAuth): Record<string, string> {
  return { Authorization: `Bearer ${auth.token}`, 'X-Username': auth.username };
}

function mediaUrl(media: MediaRef, path: string): string {
  return `${SERVER_HTTP_URL}/media/${media.bucket}/${path}`;
}

const MEDIA_DIR = `${FileSystem.documentDirectory}media/`;
const CACHE_DIR = `${FileSystem.cacheDirectory}mc/`;

const EXTENSIONS: Record<MediaKind, string> = { image: 'jpg', video: 'mp4', voice: 'm4a' };
const UPLOAD_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

// fetch no tiene limite de tiempo: sin esto una subida colgada detenia la app para siempre
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function ensureDir(dir: string) {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

export function bucketFor(kind: MediaKind): MediaRef['bucket'] {
  return kind === 'voice' ? 'voices' : 'videos';
}

async function readBytes(uri: string): Promise<Uint8Array> {
  return fromB64(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }));
}

async function writeBytes(uri: string, bytes: Uint8Array) {
  await FileSystem.writeAsStringAsync(uri, toB64(bytes), { encoding: FileSystem.EncodingType.Base64 });
}

export async function deleteFile(uri: string | null | undefined) {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // ya no existia
  }
}

// Cifra un archivo recien elegido/grabado, guarda la copia cifrada y borra el original temporal
export async function importPlainFile(messageId: string, plainUri: string, kind: MediaKind, deleteOriginal: boolean): Promise<{ media: MediaRef; mediaFile: string }> {
  const key = nacl.randomBytes(32);
  const nonce = nacl.randomBytes(24);
  const cipher = nacl.secretbox(await readBytes(plainUri), nonce, key);
  await ensureDir(MEDIA_DIR);
  const mediaFile = `${MEDIA_DIR}${messageId}.enc`;
  await writeBytes(mediaFile, cipher);
  if (deleteOriginal) await deleteIfAppFile(plainUri);
  return { media: { bucket: bucketFor(kind), key: toB64(key), nonce: toB64(nonce) }, mediaFile };
}

// Solo se borran copias dentro de las carpetas de la app, nunca un archivo de la galeria
export async function deleteIfAppFile(uri: string) {
  const isAppFile = uri.startsWith(FileSystem.documentDirectory ?? '\0') || uri.startsWith(FileSystem.cacheDirectory ?? '\0');
  if (isAppFile) await deleteFile(uri);
}

// Sube la copia cifrada, con un nombre aleatorio que no dice nada del mensaje. El sistema del telefono la manda
// directo desde el archivo (sin cargarla entera en memoria).
export async function uploadMedia(mediaFile: string, media: MediaRef, auth: MediaAuth): Promise<MediaRef> {
  const path = `${randomHex(16)}.bin`;
  const result = await withTimeout(
    FileSystem.uploadAsync(mediaUrl(media, path), mediaFile, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { ...authHeaders(auth), 'Content-Type': 'application/octet-stream' },
    }),
    UPLOAD_TIMEOUT_MS,
    'La subida del archivo tardó demasiado',
  );
  if (result.status !== 200) throw new Error(`El servidor rechazó el archivo (HTTP ${result.status}${result.body ? ': ' + result.body.slice(0, 80) : ''})`);
  return { bucket: media.bucket, key: media.key, nonce: media.nonce, path };
}

// Descarga el archivo cifrado, comprueba que descifra bien y lo guarda tal cual (cifrado)
export async function downloadMedia(messageId: string, media: MediaRef, auth: MediaAuth): Promise<string> {
  // Los mensajes de antes de este cambio solo traen la URL publica de Supabase; el nombre del archivo es lo ultimo
  const path = media.path ?? media.url?.split('/').pop();
  if (!path) throw new Error('El mensaje no trae la direccion del archivo');
  await ensureDir(MEDIA_DIR);
  const mediaFile = `${MEDIA_DIR}${messageId}.enc`;
  const result = await withTimeout(
    FileSystem.downloadAsync(mediaUrl(media, path), mediaFile, { headers: authHeaders(auth) }),
    DOWNLOAD_TIMEOUT_MS,
    'La descarga del archivo tardó demasiado',
  );
  if (result.status !== 200) {
    await deleteFile(mediaFile);
    throw new Error(`No se pudo descargar el archivo (HTTP ${result.status})`);
  }
  if (!nacl.secretbox.open(await readBytes(mediaFile), fromB64(media.nonce), fromB64(media.key))) {
    await deleteFile(mediaFile);
    throw new Error('El archivo no se pudo descifrar');
  }
  return mediaFile;
}

const decrypting = new Map<string, Promise<string>>();

// Descifra a la carpeta temporal para que el reproductor/visor pueda abrirlo
export function decryptToCache(messageId: string, kind: MediaKind, mediaFile: string, media: MediaRef): Promise<string> {
  const cacheUri = `${CACHE_DIR}${messageId}.${EXTENSIONS[kind]}`;
  const inFlight = decrypting.get(cacheUri);
  if (inFlight) return inFlight;
  const job = (async () => {
    const info = await FileSystem.getInfoAsync(cacheUri);
    if (info.exists) return cacheUri;
    const plain = nacl.secretbox.open(await readBytes(mediaFile), fromB64(media.nonce), fromB64(media.key));
    if (!plain) throw new Error('No se pudo descifrar el archivo local');
    await ensureDir(CACHE_DIR);
    await writeBytes(cacheUri, plain);
    return cacheUri;
  })().finally(() => decrypting.delete(cacheUri));
  decrypting.set(cacheUri, job);
  return job;
}

export async function removeFromCache(messageId: string) {
  for (const ext of Object.values(EXTENSIONS)) await deleteFile(`${CACHE_DIR}${messageId}.${ext}`);
}

export async function wipeCache() {
  await deleteFile(CACHE_DIR);
}

export async function readMediaFileBase64(mediaFile: string): Promise<string> {
  return FileSystem.readAsStringAsync(mediaFile, { encoding: FileSystem.EncodingType.Base64 });
}

export async function writeMediaFileBase64(messageId: string, base64: string): Promise<string> {
  await ensureDir(MEDIA_DIR);
  const mediaFile = `${MEDIA_DIR}${messageId}.enc`;
  await FileSystem.writeAsStringAsync(mediaFile, base64, { encoding: FileSystem.EncodingType.Base64 });
  return mediaFile;
}

export async function fileExists(uri: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}
