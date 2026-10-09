import { PublicIdentity } from './crypto/x3dh';

export type MessageKind = 'text' | 'image' | 'sticker' | 'video' | 'voice' | 'system';
export type MediaKind = 'image' | 'video' | 'voice';
export type MessageStatus = 'pending' | 'sent' | 'read' | 'failed';
export type DownloadState = 'none' | 'pending' | 'done' | 'failed';

// Archivo cifrado con su propia llave. `path`/`url` existen cuando ya se subio a Supabase.
export type MediaRef = {
  bucket: 'videos' | 'voices';
  key: string;
  nonce: string;
  path?: string;
  url?: string;
  pad?: 1; // el contenido cifrado lleva relleno para ocultar el tamaño real (ver media.ts)
  size?: number; // bytes del archivo cifrado (ya con relleno), para calcular el tiempo de descarga
};

export type ChatMessage = {
  id: string;
  peer: string;
  fromMe: boolean;
  kind: MessageKind;
  body: string;
  media: MediaRef | null;
  mediaFile: string | null; // copia local cifrada
  downloadState: DownloadState;
  duration: number | null;
  sentAt: number;
  status: MessageStatus;
  selfDestruct: boolean;
  ttl: number | null; // segundos que dura un mensaje temporal
  expiresAt: number | null;
  replyTo: string | null;
  editedAt: number | null;
  deleted: boolean;
  reactions: Record<string, string>;
  readByMe: boolean;
  viewOnce: boolean;
  viewed: boolean; // foto de "ver una vez" que ya se abrio (y se borro)
};

// Duraciones que se pueden elegir para los mensajes temporales (0 = desactivado)
export const TIMER_OPTIONS = [0, 30, 300, 3600, 86400, 604800] as const;

export function formatTtl(seconds: number): string {
  if (seconds <= 0) return 'desactivado';
  if (seconds < 60) return `${seconds} segundos`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutos`;
  if (seconds < 86400) return seconds === 3600 ? '1 hora' : `${Math.round(seconds / 3600)} horas`;
  if (seconds < 604800) return seconds === 86400 ? '1 día' : `${Math.round(seconds / 86400)} días`;
  return '1 semana';
}

export function shortTtl(seconds: number): string {
  if (seconds <= 0) return 'OFF';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.round(seconds / 86400)}d`;
  return '1sem';
}

// Lo que viaja cifrado dentro del Double Ratchet
export type Payload =
  | {
      t: 'msg';
      id: string;
      kind: Exclude<MessageKind, 'system'>;
      body?: string;
      media?: MediaRef;
      duration?: number;
      sentAt: number;
      selfDestruct?: boolean; // versiones anteriores: 10 segundos
      ttl?: number;
      viewOnce?: boolean;
      replyTo?: string;
    }
  | { t: 'timer'; seconds: number }
  | { t: 'pin'; id: string; pinned: boolean }
  | { t: 'pk'; key: string } // llave para descifrar la foto de perfil de quien lo manda
  | { t: 'nk'; key: string } // llave de vista previa de las notificaciones de quien lo manda
  | { t: 'clear'; upTo: number } // vaciar el chat para los dos (mensajes enviados hasta esa hora)
  | { t: 'viewed'; id: string }
  | { t: 'edit'; id: string; body: string; at: number }
  | { t: 'delete'; id: string }
  | { t: 'reaction'; id: string; emoji: string | null }
  | { t: 'read'; ids: string[] };

export type Contact = {
  username: string;
  online: boolean;
  profilePicture: string | null;
  identity: PublicIdentity | null; // la que anuncia el servidor ahora
  identityChanged: boolean; // cambio y el usuario todavia no la acepta
  verified: boolean;
  unread: number;
};
