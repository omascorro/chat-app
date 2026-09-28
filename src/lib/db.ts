import * as SQLite from 'expo-sqlite';
import { SessionRecord } from './crypto/sessions';
import { PublicIdentity } from './crypto/x3dh';
import { userKey } from './keystore';
import { ChatMessage, MediaRef } from './types';

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  peer TEXT NOT NULL,
  from_me INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media TEXT,
  media_file TEXT,
  download_state TEXT NOT NULL DEFAULT 'none',
  duration INTEGER,
  sent_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  self_destruct INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  reply_to TEXT,
  edited_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  reactions TEXT NOT NULL DEFAULT '{}',
  read_by_me INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS messages_peer_idx ON messages (peer, sent_at);
CREATE INDEX IF NOT EXISTS messages_expires_idx ON messages (expires_at);
CREATE TABLE IF NOT EXISTS sessions (peer TEXT PRIMARY KEY, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contacts (
  username TEXT PRIMARY KEY,
  pinned_sign TEXT,
  pinned_dh TEXT,
  seen_sign TEXT,
  seen_dh TEXT,
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  peer TEXT NOT NULL,
  payload TEXT NOT NULL,
  silent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS seen_inbox (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stickers (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
`;

async function addMissingColumns(db: SQLite.SQLiteDatabase, table: string, columns: Record<string, string>) {
  const existing = new Set((await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function databaseName(username: string): string {
  return `aeterna_${userKey(username)}.db`;
}

type MessageRow = {
  id: string;
  peer: string;
  from_me: number;
  kind: string;
  body: string;
  media: string | null;
  media_file: string | null;
  download_state: string;
  duration: number | null;
  sent_at: number;
  status: string;
  self_destruct: number;
  expires_at: number | null;
  reply_to: string | null;
  edited_at: number | null;
  deleted: number;
  reactions: string;
  read_by_me: number;
  ttl: number | null;
  view_once: number;
  viewed: number;
};

function rowToMessage(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    peer: r.peer,
    fromMe: r.from_me === 1,
    kind: r.kind as ChatMessage['kind'],
    body: r.body,
    media: r.media ? (JSON.parse(r.media) as MediaRef) : null,
    mediaFile: r.media_file,
    downloadState: r.download_state as ChatMessage['downloadState'],
    duration: r.duration,
    sentAt: r.sent_at,
    status: r.status as ChatMessage['status'],
    selfDestruct: r.self_destruct === 1,
    expiresAt: r.expires_at,
    replyTo: r.reply_to,
    editedAt: r.edited_at,
    deleted: r.deleted === 1,
    reactions: JSON.parse(r.reactions),
    readByMe: r.read_by_me === 1,
    ttl: r.ttl ?? null,
    viewOnce: r.view_once === 1,
    viewed: r.viewed === 1,
  };
}

export type ContactKeys = {
  pinned: PublicIdentity | null;
  seen: PublicIdentity | null;
  verified: boolean;
};

export type OutboxItem = { id: string; peer: string; payload: string; silent: boolean; createdAt: number; attempts: number; lastError: string | null };

export class Store {
  private constructor(readonly db: SQLite.SQLiteDatabase) {}

  static async open(username: string, keyHex: string): Promise<Store> {
    if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('Llave de base de datos invalida');
    const db = await SQLite.openDatabaseAsync(databaseName(username));
    // Con SQLCipher la llave tiene que ser lo primero que se ejecuta
    await db.execAsync(`PRAGMA key = '${keyHex}'`);
    await db.execAsync(SCHEMA);
    // Columnas que se agregaron despues de la primera version v2
    await addMissingColumns(db, 'outbox', { last_error: 'TEXT' });
    await addMissingColumns(db, 'messages', { ttl: 'INTEGER', view_once: 'INTEGER NOT NULL DEFAULT 0', viewed: 'INTEGER NOT NULL DEFAULT 0' });
    return new Store(db);
  }

  async close() {
    await this.db.closeAsync();
  }

  static async deleteDatabase(username: string) {
    await SQLite.deleteDatabaseAsync(databaseName(username));
  }

  // ---- mensajes ----

  async insertMessage(m: ChatMessage): Promise<boolean> {
    const res = await this.db.runAsync(
      `INSERT OR IGNORE INTO messages (id, peer, from_me, kind, body, media, media_file, download_state, duration, sent_at, status,
        self_destruct, expires_at, reply_to, edited_at, deleted, reactions, read_by_me, ttl, view_once, viewed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.id, m.peer, m.fromMe ? 1 : 0, m.kind, m.body, m.media ? JSON.stringify(m.media) : null, m.mediaFile, m.downloadState,
      m.duration, m.sentAt, m.status, m.selfDestruct ? 1 : 0, m.expiresAt, m.replyTo, m.editedAt, m.deleted ? 1 : 0,
      JSON.stringify(m.reactions), m.readByMe ? 1 : 0, m.ttl, m.viewOnce ? 1 : 0, m.viewed ? 1 : 0,
    );
    return res.changes > 0;
  }

  async getMessage(id: string): Promise<ChatMessage | null> {
    const row = await this.db.getFirstAsync<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
    return row ? rowToMessage(row) : null;
  }

  async getMessages(peer: string, limit = 500): Promise<ChatMessage[]> {
    const rows = await this.db.getAllAsync<MessageRow>(
      'SELECT * FROM (SELECT *, rowid AS arrival FROM messages WHERE peer = ? ORDER BY sent_at DESC, rowid DESC LIMIT ?) ORDER BY sent_at ASC, arrival ASC',
      peer, limit,
    );
    return rows.map(rowToMessage);
  }

  // Cuantos mensajes del chat hay desde `id` hasta el final (para cargar lo suficiente al saltar a un mensaje viejo)
  async countFrom(peer: string, id: string): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM messages WHERE peer = ? AND sent_at >= (SELECT sent_at FROM messages WHERE id = ?)',
      peer, id,
    );
    return row?.n ?? 0;
  }

  // Busqueda en todas las conversaciones (solo texto; la base esta cifrada, la busqueda se hace en el telefono).
  // Sin distinguir mayusculas ni acentos: "reunion" encuentra "Reunión" y "manana" encuentra "mañana".
  async searchAll(query: string, limit = 100): Promise<ChatMessage[]> {
    const needle = normalizeForSearch(query);
    if (!needle) return [];
    const candidates = await this.db.getAllAsync<{ id: string; body: string }>(
      "SELECT id, body FROM messages WHERE kind = 'text' AND deleted = 0 ORDER BY sent_at DESC",
    );
    const ids = candidates.filter((c) => normalizeForSearch(c.body).includes(needle)).slice(0, limit).map((c) => c.id);
    if (ids.length === 0) return [];
    const rows = await this.db.getAllAsync<MessageRow>(
      `SELECT * FROM messages WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY sent_at DESC`,
      ...ids,
    );
    return rows.map(rowToMessage);
  }

  async getAllMessages(): Promise<ChatMessage[]> {
    const rows = await this.db.getAllAsync<MessageRow>('SELECT * FROM messages WHERE kind <> ? ORDER BY sent_at ASC', 'system');
    return rows.map(rowToMessage);
  }

  async setStatus(id: string, status: ChatMessage['status']) {
    await this.db.runAsync('UPDATE messages SET status = ? WHERE id = ?', status, id);
  }

  async setBody(id: string, body: string, editedAt: number) {
    await this.db.runAsync('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', body, editedAt, id);
  }

  async markDeleted(id: string) {
    await this.db.runAsync(
      "UPDATE messages SET deleted = 1, body = '', media = NULL, media_file = NULL, download_state = 'none', reactions = '{}' WHERE id = ?",
      id,
    );
  }

  async setReactions(id: string, reactions: Record<string, string>) {
    await this.db.runAsync('UPDATE messages SET reactions = ? WHERE id = ?', JSON.stringify(reactions), id);
  }

  async setMedia(id: string, media: MediaRef | null, mediaFile: string | null, downloadState: ChatMessage['downloadState']) {
    await this.db.runAsync(
      'UPDATE messages SET media = ?, media_file = ?, download_state = ? WHERE id = ?',
      media ? JSON.stringify(media) : null, mediaFile, downloadState, id,
    );
  }

  async pendingDownloads(): Promise<ChatMessage[]> {
    const rows = await this.db.getAllAsync<MessageRow>("SELECT * FROM messages WHERE download_state = 'pending' AND deleted = 0");
    return rows.map(rowToMessage);
  }

  async deleteMessage(id: string) {
    await this.db.runAsync('DELETE FROM messages WHERE id = ?', id);
  }

  async expiredMessages(now: number): Promise<ChatMessage[]> {
    const rows = await this.db.getAllAsync<MessageRow>('SELECT * FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?', now);
    return rows.map(rowToMessage);
  }

  async setViewed(id: string) {
    await this.db.runAsync("UPDATE messages SET viewed = 1, media = NULL, media_file = NULL, download_state = 'none' WHERE id = ?", id);
  }

  // Marca como leidos los mensajes recibidos de `peer`; los temporales empiezan su cuenta regresiva ahora
  // (cada uno con su propia duracion; los de versiones anteriores sin duracion usan `selfDestructMs`)
  async markRead(peer: string, selfDestructMs: number): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ id: string; self_destruct: number }>(
      'SELECT id, self_destruct FROM messages WHERE peer = ? AND from_me = 0 AND read_by_me = 0',
      peer,
    );
    if (rows.length === 0) return [];
    const now = Date.now();
    await this.db.runAsync('UPDATE messages SET read_by_me = 1 WHERE peer = ? AND from_me = 0 AND read_by_me = 0', peer);
    await this.db.runAsync(
      'UPDATE messages SET expires_at = ? + COALESCE(ttl * 1000, ?) WHERE peer = ? AND from_me = 0 AND self_destruct = 1 AND expires_at IS NULL',
      now, selfDestructMs, peer,
    );
    return rows.map((r) => r.id);
  }

  async unreadCounts(): Promise<Record<string, number>> {
    const rows = await this.db.getAllAsync<{ peer: string; n: number }>(
      "SELECT peer, COUNT(*) AS n FROM messages WHERE from_me = 0 AND read_by_me = 0 AND kind <> 'system' GROUP BY peer",
    );
    return Object.fromEntries(rows.map((r) => [r.peer, r.n]));
  }

  // ---- sesiones del Double Ratchet ----

  async getSessions(peer: string): Promise<SessionRecord> {
    const row = await this.db.getFirstAsync<{ record: string }>('SELECT record FROM sessions WHERE peer = ?', peer);
    return row ? (JSON.parse(row.record) as SessionRecord) : [];
  }

  async saveSessions(peer: string, record: SessionRecord) {
    await this.db.runAsync('INSERT OR REPLACE INTO sessions (peer, record) VALUES (?, ?)', peer, JSON.stringify(record));
  }

  async deleteSessions(peer: string) {
    await this.db.runAsync('DELETE FROM sessions WHERE peer = ?', peer);
  }

  // ---- identidades de los contactos ----

  async getContactKeys(username: string): Promise<ContactKeys> {
    const row = await this.db.getFirstAsync<{ pinned_sign: string | null; pinned_dh: string | null; seen_sign: string | null; seen_dh: string | null; verified: number }>(
      'SELECT * FROM contacts WHERE username = ?',
      username,
    );
    if (!row) return { pinned: null, seen: null, verified: false };
    return {
      pinned: row.pinned_sign && row.pinned_dh ? { signPub: row.pinned_sign, dhPub: row.pinned_dh } : null,
      seen: row.seen_sign && row.seen_dh ? { signPub: row.seen_sign, dhPub: row.seen_dh } : null,
      verified: row.verified === 1,
    };
  }

  async saveContactKeys(username: string, keys: ContactKeys) {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO contacts (username, pinned_sign, pinned_dh, seen_sign, seen_dh, verified) VALUES (?, ?, ?, ?, ?, ?)',
      username, keys.pinned?.signPub ?? null, keys.pinned?.dhPub ?? null, keys.seen?.signPub ?? null, keys.seen?.dhPub ?? null,
      keys.verified ? 1 : 0,
    );
  }

  // ---- cola de salida ----

  async addOutbox(item: Omit<OutboxItem, 'attempts' | 'lastError'>) {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO outbox (id, peer, payload, silent, created_at, attempts) VALUES (?, ?, ?, ?, ?, 0)',
      item.id, item.peer, item.payload, item.silent ? 1 : 0, item.createdAt,
    );
  }

  async listOutbox(): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<{ id: string; peer: string; payload: string; silent: number; created_at: number; attempts: number; last_error: string | null }>(
      'SELECT * FROM outbox ORDER BY created_at ASC, rowid ASC',
    );
    return rows.map((r) => ({
      id: r.id, peer: r.peer, payload: r.payload, silent: r.silent === 1, createdAt: r.created_at, attempts: r.attempts, lastError: r.last_error,
    }));
  }

  async updateOutbox(id: string, payload: string, attempts: number) {
    await this.db.runAsync('UPDATE outbox SET payload = ?, attempts = ?, last_error = NULL WHERE id = ?', payload, attempts, id);
  }

  async setOutboxError(id: string, attempts: number, error: string) {
    await this.db.runAsync('UPDATE outbox SET attempts = ?, last_error = ? WHERE id = ?', attempts, error.slice(0, 300), id);
  }

  async deleteOutbox(id: string) {
    await this.db.runAsync('DELETE FROM outbox WHERE id = ?', id);
  }

  // ---- mensajes del servidor ya procesados (para no procesar dos veces una reentrega) ----

  async wasSeen(inboxId: string): Promise<boolean> {
    return !!(await this.db.getFirstAsync('SELECT id FROM seen_inbox WHERE id = ?', inboxId));
  }

  async markSeen(inboxId: string) {
    await this.db.runAsync('INSERT OR IGNORE INTO seen_inbox (id, at) VALUES (?, ?)', inboxId, Date.now());
  }

  async pruneSeen() {
    await this.db.runAsync('DELETE FROM seen_inbox WHERE at < ?', Date.now() - 60 * 24 * 60 * 60 * 1000);
  }

  // ---- coleccion de stickers (PNG en base64, dentro de la base cifrada) ----

  async listStickers(): Promise<{ id: string; data: string }[]> {
    return this.db.getAllAsync<{ id: string; data: string }>('SELECT id, data FROM stickers ORDER BY created_at DESC');
  }

  async addSticker(id: string, data: string): Promise<boolean> {
    const res = await this.db.runAsync('INSERT OR IGNORE INTO stickers (id, data, created_at) VALUES (?, ?, ?)', id, data, Date.now());
    return res.changes > 0;
  }

  async deleteSticker(id: string) {
    await this.db.runAsync('DELETE FROM stickers WHERE id = ?', id);
  }

  // ---- valores sueltos ----

  async getKv(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row ? row.value : null;
  }

  async setKv(key: string, value: string) {
    await this.db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
  }
}
