// Cada archivo se cifra con su propia llave (como los adjuntos de Signal). La llave viaja dentro del mensaje cifrado,
// asi que Supabase solo guarda bytes ilegibles. En el telefono se guarda la misma copia cifrada y solo se descifra
// a una carpeta temporal mientras se ve; esa carpeta se borra al salir de la app.
import * as FileSystem from 'expo-file-system/legacy';
import nacl from 'tweetnacl';
import { fromB64, randomHex, toB64 } from './crypto/primitives';
import { supabase } from './supabase';
import { MediaKind, MediaRef } from './types';

const MEDIA_DIR = `${FileSystem.documentDirectory}media/`;
const CACHE_DIR = `${FileSystem.cacheDirectory}mc/`;

const EXTENSIONS: Record<MediaKind, string> = { image: 'jpg', video: 'mp4', voice: 'm4a' };

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

// Sube la copia cifrada con un nombre aleatorio que no dice nada del mensaje
export async function uploadMedia(mediaFile: string, media: MediaRef): Promise<MediaRef> {
  const cipher = await readBytes(mediaFile);
  const path = `${randomHex(16)}.bin`;
  const { error } = await supabase.storage
    .from(media.bucket)
    .upload(path, cipher.buffer.slice(cipher.byteOffset, cipher.byteOffset + cipher.byteLength) as ArrayBuffer, {
      contentType: 'application/octet-stream',
    });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(media.bucket).getPublicUrl(path);
  return { ...media, path, url: data.publicUrl };
}

// Descarga el archivo cifrado, comprueba que descifra bien y lo guarda tal cual (cifrado)
export async function downloadMedia(messageId: string, media: MediaRef): Promise<string> {
  if (!media.url) throw new Error('El mensaje no trae la direccion del archivo');
  const resp = await fetch(media.url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const cipher = new Uint8Array(await resp.arrayBuffer());
  if (!nacl.secretbox.open(cipher, fromB64(media.nonce), fromB64(media.key))) throw new Error('El archivo no se pudo descifrar');
  await ensureDir(MEDIA_DIR);
  const mediaFile = `${MEDIA_DIR}${messageId}.enc`;
  await writeBytes(mediaFile, cipher);
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
