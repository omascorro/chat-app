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
// Las pruebas automaticas los acortan
export const MEDIA_TIMEOUTS = { upload: 90_000, download: 120_000, minBytesPerSecond: 48 * 1024 };
// El servidor acepta hasta 50 MB; con el relleno y el cifrado, 45 MB de archivo original caben con margen
export const MAX_MEDIA_BYTES = 45 * 1024 * 1024;

// El limite de tiempo crece con el tamaño (como minimo ~0.4 Mbps). Con uno fijo de 90 s los videos grandes nunca
// terminaban: se cancelaban y empezaban de cero una y otra vez.
function timeoutFor(bytes: number, base: number): number {
  // El tamaño puede venir del otro telefono: se limita a lo que el servidor acepta
  const capped = Math.min(Math.max(0, Number(bytes) || 0), 50 * 1024 * 1024);
  return Math.max(base, Math.ceil(capped / MEDIA_TIMEOUTS.minBytesPerSecond) * 1000);
}

export async function fileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && 'size' in info ? info.size ?? 0 : 0;
  } catch {
    return 0;
  }
}

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
// ---- Relleno para ocultar el tamaño real ----
// El servidor y Supabase solo ven el tamaño del archivo cifrado. Sin relleno, el tamaño exacto puede delatar que
// es (como hace Signal, se redondea hacia arriba en escalones). Formato: [largo real, 4 bytes][datos][ceros].
export function paddedLength(length: number): number {
  const n = length + 4;
  const step = n <= 256 * 1024 ? 16 * 1024 : n <= 4 * 1024 * 1024 ? 128 * 1024 : 1024 * 1024;
  return Math.ceil(n / step) * step;
}

export function pad(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(paddedLength(data.length));
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(data, 4);
  return out;
}

export function unpad(data: Uint8Array): Uint8Array {
  if (data.length < 4) throw new Error('Archivo danado');
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
  if (length > data.length - 4) throw new Error('Archivo danado');
  return data.slice(4, 4 + length);
}

export async function importPlainFile(messageId: string, plainUri: string, kind: MediaKind, deleteOriginal: boolean): Promise<{ media: MediaRef; mediaFile: string }> {
  const key = nacl.randomBytes(32);
  const nonce = nacl.randomBytes(24);
  const cipher = nacl.secretbox(pad(await readBytes(plainUri)), nonce, key);
  await ensureDir(MEDIA_DIR);
  const mediaFile = `${MEDIA_DIR}${messageId}.enc`;
  await writeBytes(mediaFile, cipher);
  if (deleteOriginal) await deleteIfAppFile(plainUri);
  return { media: { bucket: bucketFor(kind), key: toB64(key), nonce: toB64(nonce), pad: 1 }, mediaFile };
}

// Solo se borran copias dentro de las carpetas de la app, nunca un archivo de la galeria
export async function deleteIfAppFile(uri: string) {
  const isAppFile = uri.startsWith(FileSystem.documentDirectory ?? '\0') || uri.startsWith(FileSystem.cacheDirectory ?? '\0');
  if (isAppFile) await deleteFile(uri);
}

// Sube la copia cifrada, con un nombre aleatorio que no dice nada del mensaje. El sistema del telefono la manda
// directo desde el archivo (sin cargarla entera en memoria). El servidor anota para quien es: nadie mas lo puede bajar.
export async function uploadMedia(
  mediaFile: string,
  media: MediaRef,
  auth: MediaAuth,
  recipient?: string,
  onProgress?: (fraction: number) => void,
): Promise<MediaRef> {
  const path = `${randomHex(16)}.bin`;
  const size = await fileSize(mediaFile);
  const task = FileSystem.createUploadTask(
    mediaUrl(media, path),
    mediaFile,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { ...authHeaders(auth), 'Content-Type': 'application/octet-stream', ...(recipient ? { 'X-Recipient': recipient } : {}) },
    },
    (p) => onProgress?.(p.totalBytesExpectedToSend > 0 ? p.totalBytesSent / p.totalBytesExpectedToSend : 0),
  );
  let result: FileSystem.FileSystemUploadResult | null | undefined;
  try {
    result = await withTimeout(task.uploadAsync(), timeoutFor(size, MEDIA_TIMEOUTS.upload), 'La subida del archivo tardó demasiado');
  } catch (e) {
    task.cancelAsync().catch(() => {});
    throw e;
  }
  if (!result) throw new Error('La subida se canceló');
  if (result.status !== 200) throw new Error(`El servidor rechazó el archivo (HTTP ${result.status}${result.body ? ': ' + result.body.slice(0, 80) : ''})`);
  // size: para que el que recibe sepa cuanto tiempo darle a la descarga
  return { bucket: media.bucket, key: media.key, nonce: media.nonce, ...(media.pad ? { pad: 1 as const } : {}), path, ...(size ? { size } : {}) };
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
    timeoutFor(media.size ?? 0, MEDIA_TIMEOUTS.download),
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
    const opened = nacl.secretbox.open(await readBytes(mediaFile), fromB64(media.nonce), fromB64(media.key));
    if (!opened) throw new Error('No se pudo descifrar el archivo local');
    // Los archivos de antes del relleno no lo llevan
    const plain = media.pad ? unpad(opened) : opened;
    await ensureDir(CACHE_DIR);
    await writeBytes(cacheUri, plain);
    return cacheUri;
  })().finally(() => decrypting.delete(cacheUri));
  decrypting.set(cacheUri, job);
  return job;
}

// Los stickers de la coleccion viven cifrados en la base; para mostrarlos se escriben a la carpeta temporal
export async function writeStickerToCache(id: string, base64: string): Promise<string> {
  await ensureDir(CACHE_DIR);
  const uri = `${CACHE_DIR}st_${id}.png`;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

export async function readFileBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export async function removeFromCache(messageId: string) {
  for (const ext of Object.values(EXTENSIONS)) await deleteFile(`${CACHE_DIR}${messageId}.${ext}`);
}

export async function wipeCache() {
  await deleteFile(CACHE_DIR);
}

// Al arrancar la app: borra copias SIN CIFRAR que otras librerias dejan si algo se interrumpe a medias
// (el selector de fotos/camara, el reductor de imagenes y el recorte de stickers). Solo al arrancar: durante el
// uso, el selector puede estar escribiendo ahi.
export async function wipePlaintextLeftovers() {
  if (FileSystem.cacheDirectory) {
    await deleteFile(`${FileSystem.cacheDirectory}ImagePicker`);
    await deleteFile(`${FileSystem.cacheDirectory}ImageManipulator`);
  }
  // En Android el recorte de stickers deja el PNG en la carpeta principal de la app; nada nuestro vive ahi suelto
  const doc = FileSystem.documentDirectory;
  if (!doc) return;
  try {
    for (const name of await FileSystem.readDirectoryAsync(doc)) {
      if (/\.png$/i.test(name)) await deleteFile(`${doc}${name}`);
    }
  } catch {
    // carpeta no disponible
  }
}

// Boton de panico: todos los archivos (cifrados y temporales) de la app
export async function wipeAllMedia() {
  await deleteFile(MEDIA_DIR);
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
