// Un "telefono" de prueba: proceso aparte que corre el ChatClient real de la app y obedece ordenes del test.
import { appState, cleanup, control, fileExists, makeTestFile } from './mocks';

(globalThis as any).__AETERNA_SERVER_URL__ = process.env.AETERNA_TEST_SERVER;

// Se cargan despues de los mocks para que usen las versiones de Node
const { ChatClient, TIMEOUTS } = require('../../src/lib/client') as typeof import('../../src/lib/client');
const { MEDIA_TIMEOUTS } = require('../../src/lib/media') as typeof import('../../src/lib/media');

// Tiempos cortos para que las pruebas no tarden minutos
Object.assign(TIMEOUTS, { accept: 1500, request: 1500, heartbeat: 60_000, ping: 800, item: 5000, retry: 400, reconnect: 150 });
Object.assign(MEDIA_TIMEOUTS, { upload: 1500, download: 3000 });

const client = new ChatClient();
const sent: any[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, ms = 8000, what = 'condicion') {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`Tiempo agotado esperando: ${what}`);
    await sleep(25);
  }
}

// PNG minimo valido (1x1) para simular fotos y stickers
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const commands: Record<string, (...args: any[]) => Promise<unknown>> = {
  async boot() {
    await client.boot();
    await until(() => client.getSnapshot().connected, 8000, 'conexion');
  },
  async register(username: string, password: string) {
    await client.authenticate('register', username, password);
    await until(() => client.getSnapshot().phase === 'recovery' || !!client.getSnapshot().authError, 8000, 'registro');
    if (client.getSnapshot().authError) throw new Error(client.getSnapshot().authError);
    client.confirmRecoveryCode();
  },
  async addContact(username: string) {
    return client.addContact(username);
  },
  async waitContact(username: string) {
    await until(() => client.getSnapshot().contacts.some((c) => c.username === username), 8000, `contacto ${username}`);
  },
  async open(peer: string | null) {
    await client.openConversation(peer);
  },
  async sendText(peer: string, text: string, replyTo?: string) {
    await client.sendText(peer, text, { replyTo: replyTo ?? null });
  },
  async sendImage(peer: string, viewOnce = false) {
    const uri = makeTestFile(`foto-${Date.now()}.png`, PNG);
    await client.sendMedia(peer, uri, 'image', { viewOnce });
  },
  async messages(peer: string) {
    await client.openConversation(peer);
    return client.getSnapshot().messages.map((m) => ({
      id: m.id, fromMe: m.fromMe, kind: m.kind, body: m.body, status: m.status, deleted: m.deleted, editedAt: m.editedAt,
      reactions: m.reactions, replyTo: m.replyTo, downloadState: m.downloadState, hasFile: fileExists(m.mediaFile),
      viewOnce: m.viewOnce, viewed: m.viewed, ttl: m.ttl, expiresAt: m.expiresAt, sentAt: m.sentAt,
    }));
  },
  async state() {
    const s = client.getSnapshot();
    return { connected: s.connected, contacts: s.contacts, timers: s.timers, typing: s.typing, pins: (s as any).pins };
  },
  async diagnostics() {
    return client.getDiagnostics();
  },
  // Corta la conexion de golpe, como cuando el telefono pierde la red
  async dropConnection() {
    (client as any).ws?.terminate?.();
  },
  // Sin conexion de verdad: corta el socket y no deja que reconecte hasta volver
  async offline(on: boolean) {
    const c = client as any;
    if (on) {
      c.connect = () => {};
      c.ws?.terminate?.();
    } else {
      delete c.connect;
      c.connect();
      await until(() => client.getSnapshot().connected, 8000, 'reconexion');
    }
  },
  // Pierde los ACK: el servidor cree que el telefono no guardo el mensaje y lo vuelve a entregar
  async dropAcks(on: boolean) {
    const c = client as any;
    if (on) {
      const original = c.send.bind(c);
      c.__originalSend = original;
      c.send = (obj: { type?: string }) => (obj?.type === 'ack' ? true : original(obj));
    } else if (c.__originalSend) {
      c.send = c.__originalSend;
      delete c.__originalSend;
    }
  },
  async relogin(username: string, password: string) {
    // Despues de cerrar sesion el servidor corta la conexion; se espera a que la app reconecte
    await sleep(600);
    await until(() => client.getSnapshot().connected, 8000, 'reconexion');
    await client.authenticate('login', username, password);
    await until(() => client.getSnapshot().phase === 'ready' || !!client.getSnapshot().authError, 8000, 'login');
    if (client.getSnapshot().authError) throw new Error(client.getSnapshot().authError);
  },
  // Guarda lo que la app manda al servidor como direct-message (para revisar la vista previa)
  async spySends() {
    const c = client as any;
    const original = c.send.bind(c);
    sent.length = 0;
    c.send = (obj: any) => {
      if (obj?.type === 'direct-message') sent.push(obj);
      return original(obj);
    };
  },
  async sentMessages() {
    return sent;
  },
  // Descifra una foto/archivo tal como la veria el usuario y la devuelve en base64
  async decryptMedia(peer: string, id: string) {
    const { decryptToCache } = require('../../src/lib/media') as typeof import('../../src/lib/media');
    await client.openConversation(peer);
    const m = client.getSnapshot().messages.find((x) => x.id === id);
    if (!m?.mediaFile || !m.media) throw new Error('sin archivo');
    const fs = require('node:fs') as typeof import('node:fs');
    const uri = await decryptToCache(m.id, 'image', m.mediaFile, m.media);
    return fs.readFileSync(decodeURIComponent(uri.replace(/^file:\/\//, ''))).toString('base64');
  },
  // Intenta bajar un archivo del servidor con la sesion de este telefono; devuelve el codigo HTTP
  async fetchMedia(bucket: string, path: string) {
    const { SERVER_HTTP_URL } = require('../../src/lib/config') as typeof import('../../src/lib/config');
    const auth = (client as any).mediaAuth();
    const res = await fetch(`${SERVER_HTTP_URL}/media/${bucket}/${path}`, { headers: { Authorization: `Bearer ${auth.token}`, 'X-Username': auth.username } });
    return res.status;
  },
  async mediaOf(peer: string, id: string) {
    await client.openConversation(peer);
    return client.getSnapshot().messages.find((x) => x.id === id)?.media ?? null;
  },
  async prop(name: string) {
    return (client as any)[name];
  },
  // Mi foto cifrada con mi llave de perfil (como la dejo la version anterior de la app)
  async myEncryptedPicture(base64: string) {
    const { encryptPicture } = require('../../src/lib/profilePhoto') as typeof import('../../src/lib/profilePhoto');
    const c = client as any;
    return encryptPicture(await c.profileKey(c.store), base64);
  },
  async testPng() {
    return PNG.toString('base64');
  },
  async deviceKey() {
    const { getDeviceKey } = require('../../src/lib/preview') as typeof import('../../src/lib/preview');
    const key = await getDeviceKey();
    return key ? Buffer.from(key).toString('base64') : null;
  },
  async hangUploads(on: boolean) {
    control.hangUploads = on;
  },
  async uploads() {
    return control.uploads;
  },
  async background(on: boolean) {
    appState.set(on ? 'background' : 'active');
  },
  async edit(peer: string, id: string, body: string) {
    await client.editMessage(peer, id, body);
  },
  async deleteForEveryone(peer: string, id: string) {
    await client.deleteForEveryone(peer, id);
  },
  async react(peer: string, id: string, emoji: string | null) {
    await client.react(peer, id, emoji);
  },
  async setTimer(peer: string, seconds: number) {
    await client.setTimer(peer, seconds);
  },
  async viewOnce(peer: string, id: string) {
    await client.markViewOnceViewed(peer, id);
  },
  async typing(peer: string, state: 'start' | 'recording' | 'stop') {
    client.notifyTyping(peer, state);
  },
  async call(method: string, ...args: unknown[]) {
    return (client as any)[method](...args);
  },
  async exit() {
    setTimeout(() => {
      cleanup();
      process.exit(0);
    }, 50);
  },
};

process.on('message', async (msg: { id: number; cmd: string; args: unknown[] }) => {
  try {
    const fn = commands[msg.cmd];
    if (!fn) throw new Error(`Orden desconocida: ${msg.cmd}`);
    const result = await fn(...msg.args);
    process.send!({ id: msg.id, ok: true, result });
  } catch (e) {
    process.send!({ id: msg.id, ok: false, error: String((e as Error)?.stack ?? e) });
  }
});

process.send!({ ready: true });
