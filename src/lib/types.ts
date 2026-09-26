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
  expiresAt: number | null;
  replyTo: string | null;
  editedAt: number | null;
  deleted: boolean;
  reactions: Record<string, string>;
  readByMe: boolean;
};

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
      selfDestruct?: boolean;
      replyTo?: string;
    }
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
