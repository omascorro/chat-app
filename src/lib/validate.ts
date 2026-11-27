// Revision de lo que llega de afuera (mensajes del otro telefono y respaldos) antes de guardarlo o usarlo en rutas.
// Sin modulos nativos: tambien lo usan las pruebas de funciones puras.
import nacl from 'tweetnacl';
import { fromB64, utf8Bytes } from './crypto/primitives';
import { ChatMessage, MediaRef } from './types';

// Ids de mensajes: los de la app son 32 hex (newMessageId); se aceptan los de versiones o pruebas anteriores
// mientras no traigan nada que sirva para salir de una carpeta ("../", "/", "\", ":")
const ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && ID_REGEX.test(value);
}

// Mismas reglas que el servidor para los nombres de usuario (3-30 caracteres, sin caracteres de control)
export function isValidUsername(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 30 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

// El servidor solo sirve estos (ver MEDIA_ROUTE_REGEX en chat-backend/server.js)
export const MEDIA_BUCKETS = ['videos', 'voices'] as const;
const MEDIA_PATH_REGEX = /^[a-f0-9]{32}\.bin$/;
// El servidor acepta hasta 50 MB por archivo cifrado
export const MAX_ENCRYPTED_BYTES = 50 * 1024 * 1024;

function b64Length(value: unknown): number {
  if (typeof value !== 'string' || value.length > 200) return -1;
  try {
    return fromB64(value).length;
  } catch {
    return -1;
  }
}

export function isMediaPath(value: unknown): value is string {
  return typeof value === 'string' && MEDIA_PATH_REGEX.test(value);
}

// Nombre seguro para guardar en disco: sin carpetas ni caracteres raros, y con extension
export function safeFileName(name: string | undefined): string {
  const clean = (name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || 'documento';
}

// Referencia a un archivo cifrado: solo campos conocidos y con el formato correcto. null si no sirve (llave o
// nonce mal formados, bucket desconocido o una direccion que no es la de un archivo del servidor).
export function cleanMediaRef(value: unknown): MediaRef | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  if (!MEDIA_BUCKETS.includes(m.bucket as (typeof MEDIA_BUCKETS)[number])) return null;
  if (b64Length(m.key) !== nacl.secretbox.keyLength || b64Length(m.nonce) !== nacl.secretbox.nonceLength) return null;
  // Los mensajes viejos solo traen la URL publica de Supabase: se usa el ultimo pedazo y tiene que ser un archivo valido
  const legacyPath = typeof m.url === 'string' && m.url.length <= 500 ? m.url.split('/').pop() : undefined;
  if (m.path !== undefined && !isMediaPath(m.path)) return null;
  if (m.path === undefined && m.url !== undefined && !isMediaPath(legacyPath)) return null;
  const size = typeof m.size === 'number' && Number.isFinite(m.size) && m.size > 0 && m.size <= MAX_ENCRYPTED_BYTES ? Math.round(m.size) : undefined;
  const bytes = typeof m.bytes === 'number' && Number.isFinite(m.bytes) && m.bytes >= 0 && m.bytes <= MAX_ENCRYPTED_BYTES ? Math.round(m.bytes) : undefined;
  return {
    bucket: m.bucket as MediaRef['bucket'],
    key: m.key as string,
    nonce: m.nonce as string,
    ...(m.path !== undefined ? { path: m.path as string } : legacyPath !== undefined ? { path: legacyPath } : {}),
    ...(m.pad ? { pad: 1 as const } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(typeof m.name === 'string' ? { name: safeFileName(m.name) } : {}),
    ...(typeof m.mime === 'string' && m.mime.length <= 100 && /^[\w.+-]+\/[\w.+-]+$/.test(m.mime) ? { mime: m.mime } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
  };
}

// ---- respaldos ----

const BACKUP_KINDS = ['text', 'image', 'sticker', 'video', 'voice', 'file'];
const BACKUP_STATUSES = ['pending', 'sent', 'read', 'failed'];
const MAX_BACKUP_TEXT = 20_000;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e14;

// Un mensaje de un respaldo, revisado campo por campo como si llegara del otro telefono. null si no sirve.
// Los respaldos legitimos (de exportBackup, de cualquier version) siempre pasan: no traen avisos del sistema,
// temporales ni "ver una vez", y sus ids, nombres y adjuntos tienen el formato de la app.
export function cleanBackupMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  if (!isSafeId(m.id) || !isValidUsername(m.peer) || typeof m.kind !== 'string' || !BACKUP_KINDS.includes(m.kind)) return null;
  if (!isTime(m.sentAt) || typeof m.fromMe !== 'boolean') return null;
  // exportBackup nunca incluye temporales, "ver una vez" ni borrados: si vienen, el archivo fue alterado
  if (m.selfDestruct || m.viewOnce || m.deleted) return null;
  const media = m.media === null || m.media === undefined ? null : cleanMediaRef(m.media);
  if (m.media && !media) return null;
  const reactions: Record<string, string> = {};
  if (m.reactions && typeof m.reactions === 'object') {
    for (const [who, emoji] of Object.entries(m.reactions as Record<string, unknown>).slice(0, 10)) {
      if (isValidUsername(who) && typeof emoji === 'string' && emoji.length > 0 && emoji.length <= 8) reactions[who] = emoji;
    }
  }
  const status = typeof m.status === 'string' && BACKUP_STATUSES.includes(m.status) ? (m.status as ChatMessage['status']) : 'sent';
  return {
    id: m.id,
    peer: m.peer,
    fromMe: m.fromMe,
    kind: m.kind as ChatMessage['kind'],
    body: typeof m.body === 'string' ? m.body.slice(0, MAX_BACKUP_TEXT) : '',
    media,
    mediaFile: null,
    downloadState: 'none',
    duration: typeof m.duration === 'number' && Number.isFinite(m.duration) && m.duration >= 0 ? m.duration : null,
    sentAt: m.sentAt,
    status: status === 'pending' ? 'failed' : status,
    selfDestruct: false,
    ttl: null,
    expiresAt: null,
    replyTo: isSafeId(m.replyTo) ? m.replyTo : null,
    editedAt: isTime(m.editedAt) ? m.editedAt : null,
    deleted: false,
    reactions,
    readByMe: true,
    viewOnce: false,
    viewed: false,
  };
}

// Nombre local para los archivos temporales de un mensaje: siempre 32 hex, sin importar que id traiga el mensaje
export function localFileId(messageId: string): string {
  return Array.from(nacl.hash(utf8Bytes(`aeterna-file:${messageId}`)).subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

// true si `uri` es un archivo dentro de la carpeta `dir` (que termina en "/"), sin "..", "." ni separadores raros
export function isInside(dir: string, uri: string | null | undefined): uri is string {
  if (!uri || !dir.endsWith('/') || !uri.startsWith(dir)) return false;
  const rest = uri.slice(dir.length);
  if (!rest || rest.includes('\\') || rest.includes('\0') || /%2e|%2f|%5c/i.test(rest)) return false;
  return rest.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}
