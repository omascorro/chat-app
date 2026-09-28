import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { exportBackup, importBackup } from './backup';
import { fromB64, newMessageId, toB64 } from './crypto/primitives';
import { decodePayload, encodePayload, Envelope, parseHeader, PreKeyInfo } from './crypto/ratchet';
import { safetyNumber } from './crypto/safetyNumber';
import { canEncrypt, decryptWithRecord, encryptWithRecord } from './crypto/sessions';
import { Bundle, Identity, initiateSession, publicIdentity, PublicIdentity, respondToSession, SignedPreKey, verifyBundle } from './crypto/x3dh';
import { OutboxItem, Store } from './db';
import {
  clearAuthSession,
  ensureSignedPreKey,
  loadAuthSession,
  loadOrCreateDbKey,
  loadOrCreateIdentity,
  saveAuthSession,
  wipeAccountKeys,
} from './keystore';
import { log } from './log';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetAppearance } from './appearance';
import { registerBackgroundNotifications } from './backgroundNotifications';
import { encryptPreview, getOrCreateDeviceKey, keyFingerprint, previewText, resetDeviceKey } from './preview';

function fromB64Safe(value: string): Uint8Array | null {
  try {
    return value ? fromB64(value) : null;
  } catch {
    return null;
  }
}
import { SERVER_URL } from './config';
import {
  decryptToCache,
  deleteFile,
  downloadMedia,
  importPlainFile,
  MediaAuth,
  readFileBase64,
  removeFromCache,
  uploadMedia,
  wipeAllMedia,
  wipeCache,
  wipePlaintextLeftovers,
  withTimeout,
  writeStickerToCache,
} from './media';
import { prepareStickerImage, stickerIdFor } from './stickers';
import { decryptPicture, encryptPicture, isEncryptedPicture, newProfileKey } from './profilePhoto';
import { migrateLegacyData } from './migrate';
import { ChatMessage, Contact, formatTtl, MediaKind, Payload } from './types';

const PROTOCOL_VERSION = 2;
export const SELF_DESTRUCT_MS = 10_000;
export const PASSWORD_MIN_LENGTH = 8;
// Limites de tiempo; las pruebas automaticas los acortan
export const TIMEOUTS = {
  accept: 20_000, // confirmacion del servidor al mandar un mensaje
  request: 10_000,
  heartbeat: 25_000,
  ping: 6_000,
  item: 60_000, // un envio completo de la cola
  retry: 15_000, // reintento de la cola
  reconnect: 2_000,
};
const MAX_UPLOAD_ATTEMPTS = 5;
const MAX_DOWNLOAD_ATTEMPTS = 3;
const MAX_TEXT_LENGTH = 20_000;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_MESSAGE_LIMIT = 500;
const MAX_PINS = 3;
const TYPING_VISIBLE_MS = 6_000;
const TYPING_RESEND_MS = 3_000;

export type Phase = 'booting' | 'loggedOut' | 'recovery' | 'ready';

export type ClientState = {
  phase: Phase;
  connected: boolean;
  username: string;
  myProfilePicture: string | null;
  contacts: Contact[];
  authError: string;
  authInfo: string;
  authBusy: boolean;
  recoveryCode: string | null;
  updateRequired: boolean;
  openPeer: string | null;
  messages: ChatMessage[];
  cacheEpoch: number; // cambia cuando se borra la carpeta temporal: los visores vuelven a descifrar
  timers: Record<string, number>; // segundos de los mensajes temporales por conversacion (0 = desactivado)
  typing: Record<string, 'typing' | 'recording'>; // contactos que estan escribiendo o grabando un audio ahora
  typingEnabled: boolean;
  pins: Record<string, string[]>; // mensajes fijados por conversacion (el mas reciente primero, maximo 3)
  pinnedMessages: ChatMessage[]; // los fijados de la conversacion abierta
  jumpTo: string | null; // mensaje al que la pantalla del chat debe saltar (busqueda o fijado)
};

type ServerUser = { username: string; online: boolean; profilePicture: string | null; identity: PublicIdentity | null };
type SendResult = 'accepted' | 'rejected' | 'timeout';
type ItemResult = 'done' | 'blocked' | 'retry';

function sameIdentity(a: PublicIdentity | null, b: PublicIdentity | null): boolean {
  return !!a && !!b && a.signPub === b.signPub && a.dhPub === b.dhPub;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const INITIAL_STATE: ClientState = {
  phase: 'booting',
  connected: false,
  username: '',
  myProfilePicture: null,
  contacts: [],
  authError: '',
  authInfo: '',
  authBusy: false,
  recoveryCode: null,
  updateRequired: false,
  openPeer: null,
  messages: [],
  cacheEpoch: 0,
  timers: {},
  typing: {},
  typingEnabled: true,
  pins: {},
  pinnedMessages: [],
  jumpTo: null,
};

export class ChatClient {
  private state: ClientState = INITIAL_STATE;
  private listeners = new Set<() => void>();

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private authed = false;
  private token: string | null = null;
  private pendingAuthUser: string | null = null;

  private store: Store | null = null;
  private storeReady = deferred<Store>();
  private identity: Identity | null = null;
  private spks: SignedPreKey[] = [];
  private spkNeedsPublish = false;

  private inboundChain: Promise<void> = Promise.resolve();
  private locks = new Map<string, Promise<void>>();
  private seenInbox = new Set<string>();
  private sendWaiters = new Map<string, { resolve: (r: SendResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private requestWaiters = new Map<string, { resolve: (msg: any) => void; timer: ReturnType<typeof setTimeout> }>();
  private flushing = false;
  private flushAgain = false;
  private flushRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingWaiters = new Map<string, () => void>();
  private uploading = false;
  private downloading = false;
  private downloadAttempts = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private serverUsers: ServerUser[] = [];
  private serverMyPicture: string | null = null; // como la guarda el servidor (cifrada o, antes, sin cifrar)
  private migratingPicture = false;
  private appState: AppStateStatus = AppState.currentState;
  private pushRegistered = false;
  private booted = false;

  // ---------- estado para React ----------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  private setState(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ---------- arranque y conexion ----------

  async boot() {
    if (this.booted) return;
    this.booted = true;
    await wipeCache();
    await wipePlaintextLeftovers().catch(() => {});
    const typingSetting = await AsyncStorage.getItem('typing_indicators').catch(() => null);
    if (typingSetting === 'off') this.setState({ typingEnabled: false });

    AppState.addEventListener('change', (next) => this.onAppStateChange(next));

    const saved = await loadAuthSession();
    if (saved) {
      this.token = saved.token;
      this.setState({ username: saved.username, phase: 'ready' });
      try {
        await this.openAccount(saved.username);
      } catch (e) {
        log('No se pudo abrir la cuenta guardada:', e);
        await this.resetToLoggedOut('No se pudo abrir tu historial en este telefono. Inicia sesion de nuevo.');
      }
    } else {
      this.setState({ phase: 'loggedOut' });
    }
    this.connect();

    // Mientras la app esta abierta se revisa cada 25 s que la conexion siga viva
    setInterval(() => {
      if (this.appState === 'active') this.checkConnection();
    }, TIMEOUTS.heartbeat);
  }

  private onAppStateChange(next: AppStateStatus) {
    const previous = this.appState;
    this.appState = next;
    if (next === 'background') {
      // Lo descifrado para verse no se queda en disco mientras la app no esta en uso
      wipeCache().catch(() => {});
      // Asi el servidor manda notificacion aunque la conexion siga viva un rato con el telefono bloqueado
      this.sendPresence();
    }
    if (next === 'active' && previous !== 'active') this.sendPresence();
    if (/inactive|background/.test(previous) && next === 'active') {
      this.setState({ cacheEpoch: this.state.cacheEpoch + 1 });
      // En iPhone la app pasa por "inactive" muy seguido (Face ID, selector de fotos, centro de notificaciones).
      // Reconectar cada vez perdia las confirmaciones del servidor; ahora solo se reconecta si la conexion no responde.
      this.checkConnection();
      if (this.state.openPeer) this.markConversationRead(this.state.openPeer);
    }
  }

  private checkingConnection = false;
  private async checkConnection() {
    if (this.checkingConnection) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.ws || this.ws.readyState !== WebSocket.CONNECTING) this.connect();
      return;
    }
    this.checkingConnection = true;
    try {
      if (!(await this.ping(TIMEOUTS.ping))) {
        log('La conexion no respondio, se abre una nueva');
        this.connect();
      } else if (this.authed) {
        this.flush();
        this.runUploads();
      }
    } finally {
      this.checkingConnection = false;
    }
  }

  private ping(ms: number): Promise<boolean> {
    const id = newMessageId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pingWaiters.delete(id);
        resolve(false);
      }, ms);
      this.pingWaiters.set(id, () => {
        clearTimeout(timer);
        resolve(true);
      });
      if (!this.send({ type: 'ping', id })) {
        clearTimeout(timer);
        this.pingWaiters.delete(id);
        resolve(false);
      }
    });
  }

  private connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const old = this.ws;
    const socket = new WebSocket(SERVER_URL);
    this.ws = socket;
    if (old) {
      old.onclose = null;
      // Una confirmacion que ya venia en camino por la conexion vieja todavia cuenta
      old.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'accepted' || data.type === 'rejected') this.handleServerMessage(data);
        } catch {
          // ignorado
        }
      };
      old.close();
    }
    this.authed = false;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.setState({ connected: true });
      if (this.token && this.state.username) {
        this.send({ type: 'resume', v: PROTOCOL_VERSION, username: this.state.username, token: this.token });
      }
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.authed = false;
      // Si se corta mientras se inicia sesion, avisar en vez de quedarse esperando
      if (this.state.authBusy) this.setState({ authError: 'Se perdió la conexión con el servidor. Intenta de nuevo.' });
      this.setState({ connected: false, authBusy: false });
      this.failPendingSends();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, TIMEOUTS.reconnect);
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handleServerMessage(data);
    };
  }

  private send(obj: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  private failPendingSends() {
    for (const [, w] of this.sendWaiters) {
      clearTimeout(w.timer);
      w.resolve('timeout');
    }
    this.sendWaiters.clear();
    for (const [, w] of this.requestWaiters) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    this.requestWaiters.clear();
  }

  private async openAccount(username: string) {
    const identity = await loadOrCreateIdentity(username);
    const { spks, rotated } = await ensureSignedPreKey(username, identity);
    const store = await Store.open(username, await loadOrCreateDbKey(username));
    await migrateLegacyData(store, username);
    await store.pruneSeen();
    this.identity = identity;
    this.spks = spks;
    this.spkNeedsPublish = rotated;
    this.store = store;
    this.storeReady.resolve(store);
    this.startSweep();
    await this.loadTimers(store);
    await this.loadPins(store);
    await this.refreshContacts();
  }

  // Boton de panico: borra todo lo de esta cuenta en este telefono (historial, archivos y llaves) y cierra la sesion.
  // Al volver a entrar se crea una identidad nueva y el otro vera el aviso de llave cambiada.
  async panicWipe() {
    const username = this.state.username;
    this.send({ type: 'logout' });
    const store = this.store;
    this.store = null;
    if (store) await store.close().catch(() => {});
    if (username) {
      await Store.deleteDatabase(username).catch((e) => log('No se pudo borrar la base de datos:', e));
      await wipeAccountKeys(username);
      await AsyncStorage.removeItem(`messages_${username}`).catch(() => {});
    }
    await wipeAllMedia();
    await resetDeviceKey();
    await resetAppearance(); // las fotos de fondo tambien pueden ser personales
    await this.resetToLoggedOut('Se borró todo de este teléfono.');
  }

  // ---------- autenticacion ----------

  async authenticate(mode: 'login' | 'register', usernameRaw: string, password: string) {
    const username = usernameRaw.trim();
    if (!username || !password) return this.setState({ authError: 'Completa usuario y contraseña' });
    if (mode === 'register' && password.length < PASSWORD_MIN_LENGTH) {
      return this.setState({ authError: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres` });
    }
    if (!this.state.connected) return this.setState({ authError: 'Sin conexion con el servidor, espera un momento' });

    this.setState({ authBusy: true, authError: '', authInfo: '' });
    try {
      const identity = await loadOrCreateIdentity(username);
      const { spks } = await ensureSignedPreKey(username, identity);
      const spk = spks[spks.length - 1];
      this.pendingAuthUser = username;
      this.send({
        type: mode,
        v: PROTOCOL_VERSION,
        username,
        password,
        identity: publicIdentity(identity),
        spk: { id: spk.id, pub: spk.pub, sig: spk.sig },
      });
    } catch (e) {
      log('Error preparando las llaves:', e);
      this.setState({ authBusy: false, authError: 'No se pudieron preparar las llaves de cifrado' });
    }
  }

  resetPassword(usernameRaw: string, recoveryCode: string, newPassword: string) {
    const username = usernameRaw.trim();
    if (!username || !recoveryCode.trim() || !newPassword) {
      return this.setState({ authError: 'Completa usuario, código de recuperación y nueva contraseña' });
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return this.setState({ authError: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres` });
    }
    this.setState({ authBusy: true, authError: '', authInfo: '' });
    if (!this.send({ type: 'reset-password', v: PROTOCOL_VERSION, username, recoveryCode: recoveryCode.trim(), newPassword })) {
      this.setState({ authBusy: false, authError: 'Sin conexion con el servidor, espera un momento' });
    }
  }

  private async onAuthSuccess(username: string, token: string, recoveryCode: string | null) {
    this.token = token;
    this.pendingAuthUser = null;
    await saveAuthSession({ username, token });
    this.setState({ username, authBusy: false, authError: '', recoveryCode, phase: recoveryCode ? 'recovery' : 'ready' });
    if (!this.store) await this.openAccount(username);
    this.spkNeedsPublish = false; // el login ya publico la prekey actual
    this.onAuthenticated();
  }

  confirmRecoveryCode() {
    this.setState({ recoveryCode: null, phase: 'ready' });
  }

  // "inactive" (Face ID, centro de notificaciones) no cuenta: solo primer plano o segundo plano
  private sendPresence() {
    if (!this.authed) return;
    this.send({ type: 'presence', state: this.appState === 'background' ? 'background' : 'active' });
  }

  private onAuthenticated() {
    this.authed = true;
    this.sendPresence();
    if (this.spkNeedsPublish && this.spks.length > 0) {
      const spk = this.spks[this.spks.length - 1];
      this.send({ type: 'publish-spk', spk: { id: spk.id, pub: spk.pub, sig: spk.sig } });
      this.spkNeedsPublish = false;
    }
    if (!this.pushRegistered) this.registerForPushNotifications();
    this.flush();
    this.runUploads();
    this.runDownloads();
  }

  async logout() {
    this.send({ type: 'logout' });
    await this.resetToLoggedOut('');
  }

  private async resetToLoggedOut(authError: string) {
    await clearAuthSession();
    this.token = null;
    this.authed = false;
    this.pushRegistered = false;
    this.stopSweep();
    if (this.flushRetryTimer) clearTimeout(this.flushRetryTimer);
    const store = this.store;
    this.store = null;
    this.storeReady = deferred<Store>();
    this.inboundChain = Promise.resolve();
    this.seenInbox.clear();
    this.identity = null;
    this.spks = [];
    this.serverUsers = [];
    if (store) await store.close().catch(() => {});
    await wipeCache();
    this.setState({ ...INITIAL_STATE, phase: 'loggedOut', connected: this.state.connected, typingEnabled: this.state.typingEnabled, authError, cacheEpoch: this.state.cacheEpoch + 1 });
  }

  private async registerForPushNotifications() {
    this.pushRegistered = true;
    try {
      await registerBackgroundNotifications();
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Mensajes',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#6B7A3A',
        });
      }
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        finalStatus = (await Notifications.requestPermissionsAsync()).status;
      }
      if (finalStatus !== 'granted') return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      // platform y previews: el servidor manda la vista previa cifrada en el formato que este telefono sabe mostrar
      this.send({ type: 'register-push-token', token: tokenData.data, platform: Platform.OS, previews: true });
    } catch (e) {
      this.pushRegistered = false;
      log('Error registrando notificaciones:', e);
    }
  }

  // ---------- mensajes del servidor ----------

  private handleServerMessage(data: any) {
    switch (data.type) {
      case 'login-result':
      case 'register-result': {
        const username = this.pendingAuthUser;
        if (data.success && username && typeof data.token === 'string') {
          this.onAuthSuccess(username, data.token, data.type === 'register-result' ? data.recoveryCode : null).catch((e) => {
            log('Error abriendo la cuenta:', e);
            this.setState({ authBusy: false, authError: 'No se pudo abrir la base de datos cifrada' });
          });
        } else {
          this.setState({ authBusy: false, authError: data.error || 'Error al iniciar sesión', updateRequired: !!data.updateRequired });
        }
        return;
      }
      case 'reset-password-result':
        this.setState(
          data.success
            ? { authBusy: false, authError: '', authInfo: 'Contraseña actualizada. Ya puedes iniciar sesión.' }
            : { authBusy: false, authError: data.error || 'Error al restablecer la contraseña', updateRequired: !!data.updateRequired },
        );
        return;
      case 'resume-result':
        if (data.success) {
          this.storeReady.promise.then(() => this.onAuthenticated());
        } else if (data.updateRequired) {
          this.setState({ updateRequired: true, authError: data.error });
        } else if (!data.retryLater) {
          this.resetToLoggedOut('Tu sesión se cerró. Vuelve a iniciar sesión.');
        }
        return;
      case 'user-list':
        this.serverUsers = Array.isArray(data.users) ? data.users : [];
        if (data.me) this.serverMyPicture = typeof data.me.profilePicture === 'string' ? data.me.profilePicture : null;
        this.enqueueInbound(() => this.refreshContacts());
        return;
      case 'message':
        this.enqueueInbound(() => this.processInbound(String(data.id), data.from, data.envelope));
        return;
      case 'typing':
        if (typeof data.from === 'string') this.onPeerTyping(data.from, data.state);
        return;
      case 'pong': {
        const waiter = this.pingWaiters.get(data.id);
        if (waiter) {
          this.pingWaiters.delete(data.id);
          waiter();
        }
        return;
      }
      case 'accepted':
      case 'rejected': {
        const waiter = this.sendWaiters.get(data.clientId);
        if (waiter) {
          clearTimeout(waiter.timer);
          this.sendWaiters.delete(data.clientId);
          waiter.resolve(data.type === 'accepted' ? 'accepted' : 'rejected');
        }
        return;
      }
      case 'bundle-result':
      case 'add-contact-result': {
        const waiter = this.requestWaiters.get(data.requestId);
        if (waiter) {
          clearTimeout(waiter.timer);
          this.requestWaiters.delete(data.requestId);
          waiter.resolve(data);
        }
        return;
      }
    }
  }

  private request(msg: Record<string, unknown>): Promise<any> {
    const requestId = newMessageId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.requestWaiters.delete(requestId);
        resolve(null);
      }, TIMEOUTS.request);
      this.requestWaiters.set(requestId, { resolve, timer });
      if (!this.send({ ...msg, requestId })) {
        clearTimeout(timer);
        this.requestWaiters.delete(requestId);
        resolve(null);
      }
    });
  }

  private sendAndWait(clientId: string, msg: Record<string, unknown>): Promise<SendResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.sendWaiters.delete(clientId);
        resolve('timeout');
      }, TIMEOUTS.accept);
      this.sendWaiters.set(clientId, { resolve, timer });
      if (!this.send(msg)) {
        clearTimeout(timer);
        this.sendWaiters.delete(clientId);
        resolve('timeout');
      }
    });
  }

  // Todo lo que llega del servidor se procesa en orden, uno a la vez
  private enqueueInbound(fn: () => Promise<void>) {
    const ready = this.storeReady.promise;
    this.inboundChain = this.inboundChain
      .then(() => ready)
      .then(fn)
      .catch((e) => log('Error procesando un mensaje del servidor:', e));
  }

  // Evita que enviar y recibir modifiquen la misma sesion al mismo tiempo
  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => (release = r));
    const chained = previous.then(() => current);
    this.locks.set(key, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  // ---------- contactos e identidades ----------

  private async refreshContacts() {
    const store = this.store;
    if (!store) return;
    const unread = await store.unreadCounts();
    const contacts: Contact[] = [];
    for (const u of this.serverUsers) {
      const keys = await store.getContactKeys(u.username);
      if (u.identity) {
        if (!keys.pinned) {
          // Primera vez que vemos a este contacto: se confia en su llave (como Signal) hasta que la verifiquen
          keys.pinned = u.identity;
          keys.seen = u.identity;
          await store.saveContactKeys(u.username, keys);
        } else if (!sameIdentity(keys.seen, u.identity)) {
          keys.seen = u.identity;
          await store.saveContactKeys(u.username, keys);
        }
      }
      contacts.push({
        username: u.username,
        online: !!u.online,
        profilePicture: await this.openPicture(store, u.username, u.profilePicture),
        identity: keys.seen,
        identityChanged: !!keys.pinned && !!keys.seen && !sameIdentity(keys.pinned, keys.seen),
        verified: keys.verified && sameIdentity(keys.pinned, keys.seen),
        unread: unread[u.username] || 0,
      });
    }
    contacts.sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
    this.setState({ contacts, myProfilePicture: await this.openPicture(store, null, this.serverMyPicture) });
    await this.shareProfileKey(store, contacts).catch((e) => log('No se pudo compartir la llave de perfil:', e));
    // Mi foto de antes se guardo sin cifrar en el servidor: se sube otra vez, ya cifrada
    if (this.serverMyPicture && !isEncryptedPicture(this.serverMyPicture) && !this.migratingPicture) {
      this.migratingPicture = true;
      this.updateProfilePicture(this.serverMyPicture).catch((e) => log('No se pudo cifrar la foto de perfil:', e));
    }
  }

  private async profileKey(store: Store): Promise<Uint8Array> {
    const saved = fromB64Safe((await store.getKv('profile_key')) ?? '');
    if (saved?.length === 32) return saved;
    const key = newProfileKey();
    await store.setKv('profile_key', toB64(key));
    return key;
  }

  // peer null = mi propia foto. Las fotos viejas sin cifrar se muestran tal cual.
  private async openPicture(store: Store, peer: string | null, value: string | null | undefined): Promise<string | null> {
    if (!value) return null;
    if (!isEncryptedPicture(value)) return value;
    const key = peer ? fromB64Safe((await store.getKv(`peer_pk:${peer}`)) ?? '') : await this.profileKey(store);
    return decryptPicture(key?.length === 32 ? key : null, value);
  }

  // Cada contacto recibe mi llave de perfil por el canal cifrado (una vez, o de nuevo si cambia su telefono)
  private async shareProfileKey(store: Store, contacts: Contact[]) {
    const key = toB64(await this.profileKey(store));
    let queued = false;
    for (const c of contacts) {
      if (!c.identity || c.identityChanged || (await store.getKv(`pk_sent:${c.username}`)) === key) continue;
      await store.addOutbox({ id: newMessageId(), peer: c.username, payload: JSON.stringify({ t: 'pk', key }), silent: true, createdAt: Date.now() });
      await store.setKv(`pk_sent:${c.username}`, key);
      queued = true;
    }
    if (queued) this.flush();
  }

  private async noteIdentityFromPreKey(store: Store, peer: string, pk: PreKeyInfo) {
    const identity = { signPub: pk.ikSign, dhPub: pk.ikDh };
    const keys = await store.getContactKeys(peer);
    if (!keys.pinned) {
      await store.saveContactKeys(peer, { pinned: identity, seen: identity, verified: false });
    } else if (!sameIdentity(keys.seen, identity)) {
      await store.saveContactKeys(peer, { ...keys, seen: identity });
      // Su telefono es nuevo: hay que volver a mandarle mis llaves de vista previa y de perfil
      await store.deleteKv(`nk_sent:${peer}`);
      await store.deleteKv(`pk_sent:${peer}`);
    }
  }

  async acceptIdentity(peer: string) {
    const store = this.store;
    if (!store) return;
    await store.deleteKv(`nk_sent:${peer}`);
    await store.deleteKv(`pk_sent:${peer}`);
    const keys = await store.getContactKeys(peer);
    if (!keys.seen) return;
    await store.saveContactKeys(peer, { pinned: keys.seen, seen: keys.seen, verified: false });
    await this.withLock(peer, () => store.deleteSessions(peer));
    await this.addSystemMessage(peer, 'Aceptaste la llave de seguridad nueva. Verifica el número de seguridad para estar seguro.');
    await this.refreshContacts();
    this.flush();
  }

  async setVerified(peer: string, verified: boolean) {
    const store = this.store;
    if (!store) return;
    const keys = await store.getContactKeys(peer);
    await store.saveContactKeys(peer, { ...keys, verified });
    await this.refreshContacts();
  }

  async getSafetyNumber(peer: string): Promise<string | null> {
    const store = this.store;
    if (!store || !this.identity) return null;
    const keys = await store.getContactKeys(peer);
    const theirs = keys.seen || keys.pinned;
    return theirs ? safetyNumber(this.state.username, publicIdentity(this.identity), peer, theirs) : null;
  }

  async resetSession(peer: string) {
    const store = this.store;
    if (!store) return;
    await store.deleteKv(`nk_sent:${peer}`);
    await store.deleteKv(`pk_sent:${peer}`);
    await this.withLock(peer, () => store.deleteSessions(peer));
    await this.addSystemMessage(peer, 'Reiniciaste la sesión cifrada con este contacto.');
  }

  async addContact(username: string): Promise<{ success: boolean; error?: string }> {
    const res = await this.request({ type: 'add-contact', username: username.trim() });
    if (!res) return { success: false, error: 'Sin conexion con el servidor' };
    return res.success ? { success: true } : { success: false, error: res.error };
  }

  removeContact(username: string) {
    this.send({ type: 'remove-contact', username });
  }

  // La foto se cifra aqui; el servidor solo guarda bytes ilegibles
  async updateProfilePicture(base64: string): Promise<boolean> {
    const store = this.store;
    if (!store) return false;
    const encrypted = encryptPicture(await this.profileKey(store), base64);
    return this.send({ type: 'update-profile-picture', profilePicture: encrypted });
  }

  // ---------- conversacion abierta ----------

  // jumpTo: abrir el chat en un mensaje concreto (resultado de busqueda o mensaje fijado)
  async openConversation(peer: string | null, jumpTo: string | null = null) {
    const samePeer = peer === this.state.openPeer;
    this.setState({ openPeer: peer, messages: samePeer ? this.state.messages : [], pinnedMessages: samePeer ? this.state.pinnedMessages : [], jumpTo: null });
    if (!peer) return;
    if (jumpTo) await this.ensureLoaded(peer, jumpTo);
    await this.reloadMessages(peer);
    if (jumpTo) this.setState({ jumpTo });
    await this.markConversationRead(peer);
  }

  // Normalmente se cargan los ultimos 500; si se salta a uno mas viejo se cargan los necesarios
  private messageLimit = new Map<string, number>();

  private async ensureLoaded(peer: string, id: string) {
    const store = this.store;
    if (!store) return;
    const needed = (await store.countFrom(peer, id)) + 30;
    if (needed > (this.messageLimit.get(peer) ?? DEFAULT_MESSAGE_LIMIT)) this.messageLimit.set(peer, needed);
  }

  async jumpToMessage(id: string) {
    const peer = this.state.openPeer;
    if (!peer) return;
    await this.ensureLoaded(peer, id);
    await this.reloadMessages(peer);
    this.setState({ jumpTo: id });
  }

  clearJump() {
    if (this.state.jumpTo) this.setState({ jumpTo: null });
  }

  private async reloadMessages(peer: string) {
    const store = this.store;
    if (!store || this.state.openPeer !== peer) return;
    const messages = await store.getMessages(peer, this.messageLimit.get(peer) ?? DEFAULT_MESSAGE_LIMIT);
    const pinnedMessages = await this.loadPinnedMessages(store, peer);
    if (this.state.openPeer === peer) this.setState({ messages, pinnedMessages });
  }

  async searchAll(query: string): Promise<ChatMessage[]> {
    const q = query.trim();
    if (!this.store || q.length < 2) return [];
    return this.store.searchAll(q);
  }

  private async afterChange(peer: string) {
    await this.reloadMessages(peer);
    await this.refreshContacts();
  }

  private async markConversationRead(peer: string) {
    const store = this.store;
    if (!store || this.appState === 'background' || this.appState === 'inactive') return;
    const ids = await store.markRead(peer, SELF_DESTRUCT_MS);
    if (ids.length > 0) {
      await this.queuePayload(peer, { t: 'read', ids }, true);
      await this.afterChange(peer);
    }
  }

  async searchMessages(peer: string, query: string): Promise<ChatMessage[]> {
    const store = this.store;
    if (!store) return [];
    const q = query.trim().toLowerCase();
    const all = await store.getMessages(peer, 5000);
    return all.filter((m) => !m.deleted && (m.kind === 'text' || m.kind === 'sticker') && m.body.toLowerCase().includes(q));
  }

  // ---------- recepcion ----------

  private async processInbound(inboxId: string, from: string, envelope: Envelope) {
    const store = this.store;
    if (!store || !this.identity || typeof from !== 'string') return;
    if (this.seenInbox.has(inboxId) || (await store.wasSeen(inboxId))) {
      this.send({ type: 'ack', ids: [inboxId] });
      return;
    }

    const identity = this.identity;
    let payload: Payload | null = null;
    try {
      const header = parseHeader(envelope.h);
      if (header.pk) await this.noteIdentityFromPreKey(store, from, header.pk);
      // Todo bajo el mismo candado: si el envio leyera la sesion entre descifrar y guardar, reusaria una llave
      await this.withLock(from, async () => {
        const record = await store.getSessions(from);
        const result = decryptWithRecord(record, envelope, (pk) => {
          const spk = this.spks.find((s) => s.id === pk.spkId);
          if (!spk) throw new Error('Prekey desconocida');
          return respondToSession(identity, spk, pk);
        });
        try {
          payload = decodePayload<Payload>(result.plaintext);
        } catch {
          log('Contenido invalido de', from);
        }
        // Orden importante: primero se guarda el contenido (es idempotente) y despues la sesion.
        // Si la app se cierra a la mitad, la reentrega vuelve a descifrar con la sesion anterior.
        if (payload) await this.applyPayload(store, from, payload);
        await store.saveSessions(from, result.record);
      });
    } catch (e) {
      log('No se pudo descifrar un mensaje de', from, e);
      await this.addSystemMessage(from, 'No se pudo descifrar un mensaje. Si pasa seguido, reinicia la sesión cifrada desde la información del contacto.');
      await store.markSeen(inboxId);
      this.send({ type: 'ack', ids: [inboxId] });
      await this.afterChange(from);
      return;
    }

    await store.markSeen(inboxId);
    this.seenInbox.add(inboxId);
    this.send({ type: 'ack', ids: [inboxId] });
    await this.afterChange(from);
    const applied = payload as Payload | null;
    // Si llego su mensaje, ya termino de escribir
    if (applied?.t === 'msg') this.clearPeerTyping(from);
    if (applied?.t === 'msg' && applied.media) this.runDownloads();
    if (this.state.openPeer === from) await this.markConversationRead(from);
  }

  private async applyPayload(store: Store, from: string, p: Payload) {
    if (p.t === 'msg') {
      if (typeof p.id !== 'string' || p.id.length > 64 || !['text', 'image', 'sticker', 'video', 'voice'].includes(p.kind)) return;
      const now = Date.now();
      const sentAt = typeof p.sentAt === 'number' && p.sentAt < now + 5 * 60_000 ? p.sentAt : now;
      // Versiones anteriores solo mandaban selfDestruct (10 segundos)
      const ttl = typeof p.ttl === 'number' && p.ttl > 0 && p.ttl <= MAX_TTL_SECONDS ? Math.round(p.ttl) : p.selfDestruct ? SELF_DESTRUCT_MS / 1000 : null;
      await store.insertMessage({
        id: p.id,
        peer: from,
        fromMe: false,
        kind: p.kind,
        body: typeof p.body === 'string' ? p.body.slice(0, MAX_TEXT_LENGTH) : '',
        media: p.media ?? null,
        mediaFile: null,
        downloadState: p.media ? 'pending' : 'none',
        duration: typeof p.duration === 'number' ? p.duration : null,
        sentAt,
        status: 'sent',
        selfDestruct: ttl !== null,
        ttl,
        expiresAt: null,
        replyTo: typeof p.replyTo === 'string' ? p.replyTo : null,
        editedAt: null,
        deleted: false,
        reactions: {},
        readByMe: false,
        viewOnce: !!p.viewOnce && p.kind === 'image',
        viewed: false,
      });
      return;
    }

    if (p.t === 'timer') {
      const seconds = typeof p.seconds === 'number' && p.seconds >= 0 && p.seconds <= MAX_TTL_SECONDS ? Math.round(p.seconds) : null;
      if (seconds === null) return;
      await this.saveTimer(store, from, seconds);
      await this.addSystemMessage(
        from,
        seconds > 0 ? `${from} puso los mensajes temporales en ${formatTtl(seconds)}.` : `${from} desactivó los mensajes temporales.`,
      );
      return;
    }

    if (p.t === 'read') {
      for (const id of (Array.isArray(p.ids) ? p.ids : []).slice(0, 500)) {
        const target = await store.getMessage(id);
        if (target && target.fromMe && target.peer === from && target.status !== 'read') await store.setStatus(id, 'read');
      }
      return;
    }

    if (p.t === 'clear') {
      // El otro vacio el chat para los dos: se borra lo que se mando hasta ese momento
      const now = Date.now();
      if (typeof p.upTo !== 'number' || p.upTo <= 0) return;
      await this.wipeConversation(store, from, Math.min(p.upTo, now + 5 * 60_000));
      await this.addSystemMessage(from, `${from} vació el chat.`);
      return;
    }

    if (p.t === 'pk') {
      // Llave de perfil del contacto: con ella veo su foto de perfil cifrada
      if (typeof p.key === 'string' && fromB64Safe(p.key)?.length === 32) {
        await store.setKv(`peer_pk:${from}`, p.key);
        await this.refreshContacts();
      }
      return;
    }

    if (p.t === 'nk') {
      // Llave de vista previa del contacto: con ella le cifro la vista previa de mis mensajes
      if (typeof p.key === 'string' && fromB64Safe(p.key)?.length === 32) await store.setKv(`peer_nk:${from}`, p.key);
      return;
    }

    const target = await store.getMessage(p.id);
    if (!target || target.peer !== from) return;

    if (p.t === 'edit') {
      if (!target.fromMe && !target.deleted && target.kind === 'text' && typeof p.body === 'string') {
        await store.setBody(target.id, p.body.slice(0, MAX_TEXT_LENGTH), Date.now());
      }
    } else if (p.t === 'delete') {
      if (!target.fromMe) await this.deleteLocalCopy(store, target, true);
    } else if (p.t === 'reaction') {
      const reactions = { ...target.reactions };
      if (typeof p.emoji === 'string' && p.emoji.length > 0 && p.emoji.length <= 8) reactions[from] = p.emoji;
      else delete reactions[from];
      await store.setReactions(target.id, reactions);
    } else if (p.t === 'pin') {
      if (!target.deleted && target.kind !== 'system' && (await this.applyPin(store, from, target.id, !!p.pinned))) {
        await this.addSystemMessage(from, p.pinned ? `${from} fijó un mensaje.` : `${from} desfijó un mensaje.`);
      }
    } else if (p.t === 'viewed') {
      // El otro abrio la foto de "ver una vez": tambien se borra la copia de quien la mando
      if (target.fromMe && target.viewOnce && !target.viewed) {
        await deleteFile(target.mediaFile);
        await removeFromCache(target.id);
        await store.setViewed(target.id);
      }
    }
  }

  // ---------- "escribiendo..." ----------
  // Es una senal efimera que el servidor reenvia sin guardar; no lleva nada del contenido.

  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastTypingSent = new Map<string, { state: string; at: number }>();

  private onPeerTyping(peer: string, state: string) {
    const existing = this.typingTimers.get(peer);
    if (existing) clearTimeout(existing);
    this.typingTimers.delete(peer);
    if (!this.state.typingEnabled || state === 'stop') {
      this.clearPeerTyping(peer);
      return;
    }
    this.setState({ typing: { ...this.state.typing, [peer]: state === 'recording' ? 'recording' : 'typing' } });
    // Si deja de llegar la senal (se fue sin mandar nada), se quita sola
    this.typingTimers.set(peer, setTimeout(() => this.clearPeerTyping(peer), TYPING_VISIBLE_MS));
  }

  private clearPeerTyping(peer: string) {
    if (!this.state.typing[peer]) return;
    const typing = { ...this.state.typing };
    delete typing[peer];
    this.setState({ typing });
  }

  // La pantalla del chat avisa mientras se escribe o se graba; se manda como maximo cada 3 segundos
  notifyTyping(peer: string, state: 'start' | 'recording' | 'stop') {
    if (!this.state.typingEnabled || !this.authed) return;
    const last = this.lastTypingSent.get(peer);
    const now = Date.now();
    if (state === 'stop') {
      if (!last || last.state === 'stop' || now - last.at > TYPING_VISIBLE_MS) return;
    } else if (last && last.state === state && now - last.at < TYPING_RESEND_MS) {
      return;
    }
    this.lastTypingSent.set(peer, { state, at: now });
    this.send({ type: 'typing', to: peer, state });
  }

  async setTypingEnabled(enabled: boolean) {
    await AsyncStorage.setItem('typing_indicators', enabled ? 'on' : 'off').catch(() => {});
    this.setState({ typingEnabled: enabled, typing: enabled ? this.state.typing : {} });
  }

  // ---------- vaciar chat ----------

  private async wipeConversation(store: Store, peer: string, upTo: number) {
    for (const f of await store.mediaFilesOf(peer, upTo)) {
      await deleteFile(f.mediaFile);
      await removeFromCache(f.id);
    }
    await store.clearConversation(peer, upTo);
    await this.savePins(store, peer, []);
  }

  // forBoth: tambien se borra en el telefono del otro (recibe el aviso "X vacio el chat")
  async clearChat(peer: string, forBoth: boolean) {
    const store = this.store;
    if (!store) return;
    const upTo = Date.now();
    // Lo que todavia no habia salido tampoco se manda
    for (const id of await store.deletePendingMessagesTo(peer)) await removeFromCache(id);
    await this.wipeConversation(store, peer, upTo);
    if (forBoth) await this.queuePayload(peer, { t: 'clear', upTo }, true);
    await this.addSystemMessage(peer, forBoth ? 'Vaciaste el chat para los dos.' : 'Vaciaste el chat en este teléfono.');
    await this.afterChange(peer);
  }

  // ---------- mensajes fijados ----------
  // Se fijan para los dos (como WhatsApp), hasta 3 por conversacion.

  private async loadPins(store: Store) {
    const rows = await store.db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM kv WHERE key LIKE 'pins:%'");
    const pins: Record<string, string[]> = {};
    for (const r of rows) {
      try {
        pins[r.key.slice('pins:'.length)] = JSON.parse(r.value);
      } catch {
        // valor danado: se ignora
      }
    }
    this.setState({ pins });
  }

  private async savePins(store: Store, peer: string, ids: string[]) {
    await store.setKv(`pins:${peer}`, JSON.stringify(ids));
    this.setState({ pins: { ...this.state.pins, [peer]: ids } });
  }

  // Los fijados que ya no existen (borrados o temporales vencidos) se quitan solos
  private async loadPinnedMessages(store: Store, peer: string): Promise<ChatMessage[]> {
    const ids = this.state.pins[peer] ?? [];
    if (ids.length === 0) return [];
    const found: ChatMessage[] = [];
    for (const id of ids) {
      const m = await store.getMessage(id);
      if (m && !m.deleted && m.kind !== 'system') found.push(m);
    }
    if (found.length !== ids.length) await this.savePins(store, peer, found.map((m) => m.id));
    return found;
  }

  private async applyPin(store: Store, peer: string, id: string, pinned: boolean): Promise<boolean> {
    const current = this.state.pins[peer] ?? [];
    const without = current.filter((x) => x !== id);
    const next = pinned ? [id, ...without].slice(0, MAX_PINS) : without;
    if (JSON.stringify(next) === JSON.stringify(current)) return false;
    await this.savePins(store, peer, next);
    return true;
  }

  async setPinned(peer: string, id: string, pinned: boolean) {
    const store = this.store;
    const target = store ? await store.getMessage(id) : null;
    if (!store || !target || target.peer !== peer || target.deleted || target.kind === 'system') return;
    if (!(await this.applyPin(store, peer, id, pinned))) return;
    await this.addSystemMessage(peer, pinned ? 'Fijaste un mensaje.' : 'Desfijaste un mensaje.');
    await this.queuePayload(peer, { t: 'pin', id, pinned }, true);
  }

  // ---------- mensajes temporales ----------

  private async saveTimer(store: Store, peer: string, seconds: number) {
    await store.setKv(`timer:${peer}`, String(seconds));
    this.setState({ timers: { ...this.state.timers, [peer]: seconds } });
  }

  private async loadTimers(store: Store) {
    const rows = await store.db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM kv WHERE key LIKE 'timer:%'");
    const timers: Record<string, number> = {};
    for (const r of rows) timers[r.key.slice('timer:'.length)] = Number(r.value) || 0;
    this.setState({ timers });
  }

  // El ajuste es de la conversacion: se le avisa al otro telefono para que use el mismo
  async setTimer(peer: string, seconds: number) {
    const store = this.store;
    if (!store) return;
    await this.saveTimer(store, peer, seconds);
    await this.addSystemMessage(peer, seconds > 0 ? `Pusiste los mensajes temporales en ${formatTtl(seconds)}.` : 'Desactivaste los mensajes temporales.');
    await this.queuePayload(peer, { t: 'timer', seconds }, true);
  }

  // ---------- fotos de "ver una vez" ----------

  async markViewOnceViewed(peer: string, id: string) {
    const store = this.store;
    const target = store ? await store.getMessage(id) : null;
    if (!store || !target || target.fromMe || !target.viewOnce || target.viewed) return;
    await deleteFile(target.mediaFile);
    await removeFromCache(id);
    await store.setViewed(id);
    await this.reloadMessages(peer);
    await this.queuePayload(peer, { t: 'viewed', id }, true);
  }

  private async deleteLocalCopy(store: Store, message: ChatMessage, keepPlaceholder: boolean) {
    await deleteFile(message.mediaFile);
    await removeFromCache(message.id);
    if (keepPlaceholder) await store.markDeleted(message.id);
    else await store.deleteMessage(message.id);
  }

  private async addSystemMessage(peer: string, body: string) {
    const store = this.store;
    if (!store) return;
    await store.insertMessage({
      id: newMessageId(), peer, fromMe: false, kind: 'system', body, media: null, mediaFile: null, downloadState: 'none',
      duration: null, sentAt: Date.now(), status: 'sent', selfDestruct: false, ttl: null, expiresAt: null, replyTo: null, editedAt: null,
      deleted: false, reactions: {}, readByMe: true, viewOnce: false, viewed: false,
    });
    await this.reloadMessages(peer);
  }

  // ---------- descargas ----------

  private downloadAgain = false;
  private downloadRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private async runDownloads() {
    // Si llega otro archivo mientras se descarga uno, se revisa otra vez al terminar
    // (antes se ignoraba y la segunda foto se quedaba en "Descargando…")
    if (this.downloading) {
      this.downloadAgain = true;
      return;
    }
    const store = this.store;
    if (!store) return;
    this.downloading = true;
    let retryLater = false;
    try {
      do {
        this.downloadAgain = false;
        for (const m of await store.pendingDownloads()) {
          if (!m.media || this.store !== store) continue;
          try {
            const auth = this.mediaAuth();
            if (!auth) break;
            const mediaFile = await downloadMedia(m.id, m.media, auth);
            await store.setMedia(m.id, m.media, mediaFile, 'done');
            // Ya lo tenemos: el servidor puede borrar la copia de Supabase
            if (m.media.path) this.send({ type: 'media-done', bucket: m.media.bucket, path: m.media.path });
          } catch (e) {
            log('No se pudo descargar un archivo:', e);
            const attempts = (this.downloadAttempts.get(m.id) || 0) + 1;
            this.downloadAttempts.set(m.id, attempts);
            if (attempts >= MAX_DOWNLOAD_ATTEMPTS) await store.setMedia(m.id, m.media, null, 'failed');
            else retryLater = true;
          }
          await this.reloadMessages(m.peer);
        }
      } while (this.downloadAgain);
    } finally {
      this.downloading = false;
    }
    // Un fallo pasajero (red) se reintenta solo, sin esperar a que llegue otro mensaje
    if (retryLater && !this.downloadRetryTimer) {
      this.downloadRetryTimer = setTimeout(() => {
        this.downloadRetryTimer = null;
        this.runDownloads();
      }, TIMEOUTS.retry);
    }
  }

  async retryDownload(id: string) {
    const store = this.store;
    const message = store ? await store.getMessage(id) : null;
    if (!store || !message || !message.media) return;
    this.downloadAttempts.delete(id);
    await store.setMedia(id, message.media, null, 'pending');
    await this.reloadMessages(message.peer);
    this.runDownloads();
  }

  // ---------- envio ----------

  // Usa el temporizador que tenga la conversacion en ese momento
  // La hora de mis mensajes siempre avanza, aunque se creen en el mismo milisegundo (asi el orden es exacto)
  private lastOutgoingAt = 0;

  private newOutgoing(peer: string, kind: ChatMessage['kind'], body: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    const now = Math.max(Date.now(), this.lastOutgoingAt + 1);
    this.lastOutgoingAt = now;
    const ttl = this.state.timers[peer] || 0;
    return {
      id: newMessageId(), peer, fromMe: true, kind, body, media: null, mediaFile: null, downloadState: 'none', duration: null,
      sentAt: now, status: 'pending', selfDestruct: ttl > 0, ttl: ttl > 0 ? ttl : null, expiresAt: ttl > 0 ? now + ttl * 1000 : null,
      replyTo: null, editedAt: null, deleted: false, reactions: {}, readByMe: true, viewOnce: false, viewed: false, ...extra,
    };
  }

  private payloadFor(m: ChatMessage): Payload {
    return {
      t: 'msg',
      id: m.id,
      kind: m.kind as Exclude<ChatMessage['kind'], 'system'>,
      body: m.body || undefined,
      media: m.media ? { bucket: m.media.bucket, key: m.media.key, nonce: m.media.nonce, ...(m.media.pad ? { pad: 1 as const } : {}) } : undefined,
      duration: m.duration ?? undefined,
      sentAt: m.sentAt,
      selfDestruct: m.selfDestruct || undefined,
      ttl: m.ttl ?? undefined,
      viewOnce: m.viewOnce || undefined,
      replyTo: m.replyTo ?? undefined,
    };
  }

  // La primera vez que le escribo a alguien (o si mi llave cambio) le mando mi llave de vista previa
  private async ensurePreviewKeyShared(store: Store, peer: string) {
    const key = await getOrCreateDeviceKey();
    const fingerprint = keyFingerprint(key);
    if ((await store.getKv(`nk_sent:${peer}`)) === fingerprint) return;
    await store.addOutbox({ id: newMessageId(), peer, payload: JSON.stringify({ t: 'nk', key: toB64(key) }), silent: true, createdAt: Date.now() });
    await store.setKv(`nk_sent:${peer}`, fingerprint);
  }

  // Vista previa cifrada con la llave del destinatario (si ya me la mando); el servidor no la puede leer
  private async buildPreview(store: Store, peer: string, payload: Payload): Promise<string | undefined> {
    if (payload.t !== 'msg') return undefined;
    const peerKey = fromB64Safe((await store.getKv(`peer_nk:${peer}`)) ?? '');
    if (!peerKey || peerKey.length !== 32) return undefined;
    return encryptPreview(peerKey, { f: this.state.username, b: previewText(payload) });
  }

  private async queueOutgoing(message: ChatMessage) {
    const store = this.store;
    if (!store) return;
    await this.ensurePreviewKeyShared(store, message.peer).catch((e) => log('No se pudo compartir la llave de vista previa:', e));
    await store.insertMessage(message);
    await store.addOutbox({ id: message.id, peer: message.peer, payload: JSON.stringify(this.payloadFor(message)), silent: false, createdAt: Date.now() });
    await this.reloadMessages(message.peer);
    this.flush();
  }

  private async queuePayload(peer: string, payload: Payload, silent: boolean) {
    const store = this.store;
    if (!store) return;
    await store.addOutbox({ id: newMessageId(), peer, payload: JSON.stringify(payload), silent, createdAt: Date.now() });
    this.flush();
  }

  async sendText(peer: string, text: string, options: { replyTo?: string | null } = {}) {
    const body = text.slice(0, MAX_TEXT_LENGTH);
    if (!body.trim()) return;
    await this.queueOutgoing(this.newOutgoing(peer, 'text', body, { replyTo: options.replyTo ?? null }));
  }

  async sendSticker(peer: string, emoji: string) {
    await this.queueOutgoing(this.newOutgoing(peer, 'sticker', emoji));
  }

  // ---------- stickers (imagenes) ----------

  async listStickers(): Promise<{ id: string; uri: string }[]> {
    const store = this.store;
    if (!store) return [];
    const rows = await store.listStickers();
    return Promise.all(rows.map(async (r) => ({ id: r.id, uri: await writeStickerToCache(r.id, r.data) })));
  }

  // Devuelve false si ese sticker ya estaba en la coleccion
  async addStickerFromImage(uri: string, width?: number, height?: number): Promise<boolean> {
    const store = this.store;
    if (!store) return false;
    const { id, base64 } = await prepareStickerImage(uri, width, height);
    return store.addSticker(id, base64);
  }

  async deleteSticker(id: string) {
    await this.store?.deleteSticker(id);
  }

  // Guardar en la coleccion un sticker que me mandaron
  async saveReceivedSticker(messageId: string): Promise<boolean> {
    const store = this.store;
    const message = store ? await store.getMessage(messageId) : null;
    if (!store || !message || message.kind !== 'sticker' || !message.mediaFile || !message.media) return false;
    const plain = await decryptToCache(message.id, 'image', message.mediaFile, message.media);
    const base64 = await readFileBase64(plain);
    return store.addSticker(stickerIdFor(base64), base64);
  }

  // Se manda como una foto cifrada, pero se muestra sin burbuja
  async sendStickerImage(peer: string, stickerId: string) {
    const store = this.store;
    if (!store) return;
    const row = (await store.listStickers()).find((s) => s.id === stickerId);
    if (!row) return;
    const message = this.newOutgoing(peer, 'sticker', '');
    const tempUri = await writeStickerToCache(`send_${message.id}`, row.data);
    const { media, mediaFile } = await importPlainFile(message.id, tempUri, 'image', true);
    await this.queueOutgoing({ ...message, media, mediaFile, downloadState: 'done' });
  }

  async sendMedia(peer: string, plainUri: string, kind: MediaKind, options: { duration?: number; replyTo?: string | null; viewOnce?: boolean } = {}) {
    const message = this.newOutgoing(peer, kind, '', {
      duration: options.duration ?? null,
      replyTo: options.replyTo ?? null,
      viewOnce: !!options.viewOnce && kind === 'image',
    });
    const { media, mediaFile } = await importPlainFile(message.id, plainUri, kind, true);
    await this.queueOutgoing({ ...message, media, mediaFile, downloadState: 'done' });
  }

  async editMessage(peer: string, id: string, body: string) {
    const store = this.store;
    const target = store ? await store.getMessage(id) : null;
    if (!store || !target || !target.fromMe || target.kind !== 'text' || target.deleted || !body.trim()) return;
    const text = body.slice(0, MAX_TEXT_LENGTH);
    const at = Date.now();
    await store.setBody(id, text, at);
    await this.reloadMessages(peer);
    await this.queuePayload(peer, { t: 'edit', id, body: text, at }, true);
  }

  async deleteForEveryone(peer: string, id: string) {
    const store = this.store;
    const target = store ? await store.getMessage(id) : null;
    if (!store || !target || !target.fromMe) return;
    await store.deleteOutbox(id); // si no habia salido, ya no sale
    await this.deleteLocalCopy(store, target, true);
    await this.reloadMessages(peer);
    await this.queuePayload(peer, { t: 'delete', id }, true);
    // La copia cifrada tampoco se queda en el servidor hasta la limpieza de 14 dias
    if (target.media?.path) this.send({ type: 'media-done', bucket: target.media.bucket, path: target.media.path });
  }

  async deleteForMe(id: string) {
    const store = this.store;
    const target = store ? await store.getMessage(id) : null;
    if (!store || !target) return;
    await this.deleteLocalCopy(store, target, false);
    await this.reloadMessages(target.peer);
  }

  async react(peer: string, id: string, emoji: string | null) {
    const store = this.store;
    const target = store ? await store.getMessage(id) : null;
    if (!store || !target || target.deleted || target.kind === 'system') return;
    const reactions = { ...target.reactions };
    if (emoji) reactions[this.state.username] = emoji;
    else delete reactions[this.state.username];
    await store.setReactions(id, reactions);
    await this.reloadMessages(peer);
    await this.queuePayload(peer, { t: 'reaction', id, emoji }, true);
  }

  async retrySend(id: string) {
    const store = this.store;
    const message = store ? await store.getMessage(id) : null;
    if (!store || !message || !message.fromMe || message.status !== 'failed') return;
    await store.setStatus(id, 'pending');
    await store.addOutbox({ id, peer: message.peer, payload: JSON.stringify(this.payloadFor(message)), silent: false, createdAt: Date.now() });
    await this.reloadMessages(message.peer);
    this.flush();
  }

  // Manda la cola de salida en orden. Cada mensaje se queda en la cola hasta que el servidor confirma que lo guardo.
  private async flush() {
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    let retryLater = false;
    try {
      do {
        this.flushAgain = false;
        const store = this.store;
        if (!store || !this.authed) break;
        const blocked = new Set<string>();
        let waitingUpload = false;
        for (const item of await store.listOutbox()) {
          if (!this.authed || this.store !== store) break;
          if (blocked.has(item.peer)) continue;
          // Un archivo que todavia se esta subiendo no detiene a los textos que vienen detras
          if (this.needsUpload(item)) {
            waitingUpload = true;
            continue;
          }
          let result: ItemResult;
          try {
            result = await withTimeout(this.sendOutboxItem(store, item), TIMEOUTS.item, 'Se agotó el tiempo al enviar');
          } catch (e) {
            await store.setOutboxError(item.id, item.attempts + 1, String((e as Error)?.message ?? e));
            result = 'retry';
          }
          if (result === 'blocked') blocked.add(item.peer);
          if (result === 'retry') {
            retryLater = true;
            break;
          }
        }
        if (blocked.size > 0) retryLater = true;
        if (waitingUpload) this.runUploads();
      } while (this.flushAgain && !retryLater);
    } catch (e) {
      log('Error enviando la cola de salida:', e);
      retryLater = true;
    } finally {
      this.flushing = false;
    }
    if (retryLater) this.scheduleRetry();
  }

  // ---------- diagnostico ----------

  async getDiagnostics() {
    const store = this.store;
    const outbox = store ? await store.listOutbox() : [];
    return {
      connected: this.state.connected,
      authed: this.authed,
      lastUploadError: store ? await store.getKv('last_upload_error') : null,
      outbox: outbox.map((item) => {
        let what = 'mensaje';
        try {
          const p = JSON.parse(item.payload) as Payload;
          what = p.t === 'msg' ? (p.media ? `${p.kind}${p.media.path ? ' (ya subido)' : ' (sin subir)'}` : p.kind) : p.t;
        } catch {
          // payload ilegible
        }
        return { id: item.id, peer: item.peer, what, attempts: item.attempts, lastError: item.lastError, ageSeconds: Math.round((Date.now() - item.createdAt) / 1000) };
      }),
    };
  }

  retryNow() {
    if (this.flushRetryTimer) clearTimeout(this.flushRetryTimer);
    this.flushRetryTimer = null;
    this.checkConnection();
    this.flush();
    this.runUploads();
  }

  private mediaAuth(): MediaAuth | null {
    return this.token && this.state.username ? { username: this.state.username, token: this.token } : null;
  }

  private needsUpload(item: OutboxItem): boolean {
    try {
      const payload = JSON.parse(item.payload) as Payload;
      return payload.t === 'msg' && !!payload.media && !payload.media.path;
    } catch {
      return false;
    }
  }

  // Sube los archivos pendientes, uno a la vez y aparte de la cola de mensajes.
  // Cuando uno termina, su mensaje ya puede salir en el siguiente envio de la cola.
  private async runUploads() {
    if (this.uploading) return;
    const store = this.store;
    if (!store || !this.authed) return;
    this.uploading = true;
    let uploadedSomething = false;
    try {
      for (const item of await store.listOutbox()) {
        if (!this.needsUpload(item) || this.store !== store) continue;
        const payload = JSON.parse(item.payload) as Extract<Payload, { t: 'msg' }>;
        const message = await store.getMessage(payload.id);
        if (!message || !message.mediaFile || message.deleted || !payload.media) {
          await store.deleteOutbox(item.id);
          continue;
        }
        try {
          const auth = this.mediaAuth();
          if (!auth) break;
          payload.media = await uploadMedia(message.mediaFile, payload.media, auth, message.peer);
          await store.updateOutbox(item.id, JSON.stringify(payload), item.attempts);
          await store.setMedia(message.id, payload.media, message.mediaFile, 'done');
          uploadedSomething = true;
        } catch (e) {
          const error = String((e as Error)?.message ?? e);
          log('Error subiendo un archivo:', error);
          const attempts = item.attempts + 1;
          if (attempts >= MAX_UPLOAD_ATTEMPTS) {
            await store.deleteOutbox(item.id);
            await store.setStatus(payload.id, 'failed');
            await store.setKv('last_upload_error', error);
            await this.reloadMessages(item.peer);
          } else {
            await store.setOutboxError(item.id, attempts, error);
            this.scheduleRetry();
          }
        }
      }
    } finally {
      this.uploading = false;
    }
    if (uploadedSomething) this.flush();
  }

  private scheduleRetry() {
    if (this.flushRetryTimer) return;
    this.flushRetryTimer = setTimeout(() => {
      this.flushRetryTimer = null;
      this.flush();
      this.runUploads();
    }, TIMEOUTS.retry);
  }

  private async sendOutboxItem(store: Store, item: OutboxItem): Promise<ItemResult> {
    const payload = JSON.parse(item.payload) as Payload;

    // Cifrar con la sesion del contacto (o crearla con X3DH)
    const identity = this.identity;
    if (!identity) return 'retry';
    const keys = await store.getContactKeys(item.peer);
    if (keys.pinned && keys.seen && !sameIdentity(keys.pinned, keys.seen)) {
      await store.setOutboxError(item.id, item.attempts, 'La llave de seguridad del contacto cambió; acéptala para enviar');
      return 'blocked';
    }

    const encrypted = await this.withLock(item.peer, async (): Promise<Envelope | 'blocked'> => {
      let record = await store.getSessions(item.peer);
      if (!canEncrypt(record)) {
        const res = await this.request({ type: 'get-bundle', username: item.peer });
        const bundle: Bundle | null = res?.bundle ?? null;
        if (!bundle || !verifyBundle(bundle)) {
          await store.setOutboxError(item.id, item.attempts, res ? 'El contacto todavía no instala la versión nueva de la app' : 'El servidor no respondió al pedir las llaves');
          return 'blocked';
        }
        const current = await store.getContactKeys(item.peer);
        if (!current.pinned) {
          await store.saveContactKeys(item.peer, { pinned: bundle.identity, seen: bundle.identity, verified: false });
        } else if (!sameIdentity(current.pinned, bundle.identity)) {
          // El servidor anuncia otra llave: no se manda nada hasta que el usuario la acepte
          await store.saveContactKeys(item.peer, { ...current, seen: bundle.identity });
          return 'blocked';
        }
        record = [initiateSession(identity, bundle), ...record];
      }
      const { record: updated, envelope } = encryptWithRecord(record, encodePayload(payload));
      await store.saveSessions(item.peer, updated);
      return envelope;
    });
    if (encrypted === 'blocked') {
      await this.refreshContacts();
      return 'blocked';
    }

    // 3. Mandar y esperar la confirmacion del servidor
    const preview = item.silent ? undefined : await this.buildPreview(store, item.peer, payload).catch(() => undefined);
    const result = await this.sendAndWait(item.id, { type: 'direct-message', to: item.peer, clientId: item.id, envelope: encrypted, silent: item.silent, preview });
    if (result === 'timeout') {
      await store.setOutboxError(item.id, item.attempts + 1, 'El servidor no confirmó que recibió el mensaje');
      return 'retry';
    }
    await store.deleteOutbox(item.id);
    if (payload.t === 'msg') {
      const message = await store.getMessage(payload.id);
      if (message && message.status === 'pending') await store.setStatus(payload.id, result === 'accepted' ? 'sent' : 'failed');
      // Una foto de "ver una vez" ya salio: quien la mando tampoco se queda con copia
      if (message && result === 'accepted' && message.viewOnce) {
        await deleteFile(message.mediaFile);
        await store.setMedia(message.id, null, null, 'none');
      }
      await this.reloadMessages(item.peer);
    }
    return 'done';
  }

  // ---------- autodestruccion ----------

  private startSweep() {
    this.stopSweep();
    this.sweepTimer = setInterval(() => this.sweepExpired(), 1000);
    this.sweepExpired();
  }

  private stopSweep() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  private sweeping = false;
  private async sweepExpired() {
    const store = this.store;
    if (!store || this.sweeping) return;
    this.sweeping = true;
    try {
      const expired = await store.expiredMessages(Date.now());
      const peers = new Set<string>();
      for (const m of expired) {
        await this.deleteLocalCopy(store, m, false);
        peers.add(m.peer);
      }
      for (const peer of peers) await this.reloadMessages(peer);
    } catch (e) {
      log('Error borrando mensajes que se autodestruyen:', e);
    } finally {
      this.sweeping = false;
    }
  }

  // ---------- respaldo ----------

  async exportBackup(password: string, includeMedia: boolean): Promise<string> {
    if (!this.store) throw new Error('No hay sesion abierta');
    return exportBackup(this.store, this.state.username, password, includeMedia);
  }

  async importBackup(uri: string, password: string): Promise<number> {
    if (!this.store) throw new Error('No hay sesion abierta');
    const restored = await importBackup(this.store, uri, password);
    await this.refreshContacts();
    if (this.state.openPeer) await this.reloadMessages(this.state.openPeer);
    return restored;
  }

  getMyUsername() {
    return this.state.username;
  }
}

export const client = new ChatClient();
