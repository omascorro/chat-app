// Documentos (PDF, Word, Excel…): se descifran a la carpeta temporal con su nombre real y se abren con las apps del
// telefono. Mientras la otra app lo lee, Aeterna queda en segundo plano: por eso la copia se conserva unos minutos
// en vez de borrarse al salir (despues se borra sola).
import * as Sharing from 'expo-sharing';
import { decryptToCache, deleteFile, keepWhilePlaying } from './media';
import { ChatMessage } from './types';

const KEEP_OPEN_MS = 5 * 60_000;

export async function openDocument(message: ChatMessage): Promise<void> {
  if (!message.mediaFile || !message.media) throw new Error('El documento todavía no se descarga');
  const uri = await decryptToCache(message.id, 'file', message.mediaFile, message.media);
  keepWhilePlaying(uri, true);
  setTimeout(() => {
    keepWhilePlaying(uri, false);
    deleteFile(uri);
  }, KEEP_OPEN_MS);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Este teléfono no puede abrir documentos desde la app');
  await Sharing.shareAsync(uri, {
    mimeType: message.media.mime ?? 'application/octet-stream',
    dialogTitle: fileNameOf(message),
  });
}

// Nombre del documento. Los primeros documentos (antes de los comentarios) lo guardaban en el cuerpo del mensaje.
export function fileNameOf(m: ChatMessage): string {
  return m.media?.name || m.body || 'Documento';
}

// Comentario escrito al mandar una foto, video o documento (vacio si no hay)
export function captionOf(m: ChatMessage): string {
  if (m.kind === 'file' && m.body === m.media?.name) return '';
  return m.body;
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function documentIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return '📕';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'pages'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(ext)) return '📊';
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return '📽';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return '🎵';
  return '📄';
}

export function documentType(name: string): string {
  const ext = name.split('.').pop();
  return ext && ext !== name ? ext.toUpperCase() : 'Archivo';
}
