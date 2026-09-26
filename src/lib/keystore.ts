import * as SecureStore from 'expo-secure-store';
import { randomHex, utf8Bytes } from './crypto/primitives';
import { generateIdentity, generateSignedPreKey, Identity, SignedPreKey } from './crypto/x3dh';

// Nunca salen del telefono: no se sincronizan con iCloud ni con respaldos del sistema
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const SPK_ROTATION_MS = 7 * 24 * 60 * 60 * 1000;
const SPKS_TO_KEEP = 3; // las viejas se guardan un tiempo por si llega un mensaje atrasado

// SecureStore solo acepta letras, numeros, ".", "-" y "_" en las llaves; el nombre de usuario puede tener cualquier cosa
export function userKey(username: string): string {
  return Array.from(utf8Bytes(username), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key, OPTIONS);
  return raw ? (JSON.parse(raw) as T) : null;
}

async function setJson(key: string, value: unknown) {
  await SecureStore.setItemAsync(key, JSON.stringify(value), OPTIONS);
}

export async function loadOrCreateIdentity(username: string): Promise<Identity> {
  const key = `id2_${userKey(username)}`;
  const existing = await getJson<Identity>(key);
  if (existing) return existing;
  const identity = generateIdentity();
  await setJson(key, identity);
  return identity;
}

export async function loadSignedPreKeys(username: string): Promise<SignedPreKey[]> {
  return (await getJson<SignedPreKey[]>(`spk_${userKey(username)}`)) || [];
}

// Devuelve las prekeys y si hay que publicar una nueva (la primera vez o cada 7 dias)
export async function ensureSignedPreKey(username: string, identity: Identity): Promise<{ spks: SignedPreKey[]; rotated: boolean }> {
  const spks = await loadSignedPreKeys(username);
  const current = spks[spks.length - 1];
  if (current && Date.now() - current.createdAt < SPK_ROTATION_MS) return { spks, rotated: false };
  const id = Math.floor(Math.random() * 2147483646) + 1;
  const next = [...spks, generateSignedPreKey(identity, id)].slice(-SPKS_TO_KEEP);
  await setJson(`spk_${userKey(username)}`, next);
  return { spks: next, rotated: true };
}

export type StoredSession = { username: string; token: string };

export async function loadAuthSession(): Promise<StoredSession | null> {
  return getJson<StoredSession>('auth_session');
}

export async function saveAuthSession(session: StoredSession) {
  await setJson('auth_session', session);
}

export async function clearAuthSession() {
  await SecureStore.deleteItemAsync('auth_session', OPTIONS);
}

export async function loadOrCreateDbKey(username: string): Promise<string> {
  const key = `dbkey_${userKey(username)}`;
  const existing = await SecureStore.getItemAsync(key, OPTIONS);
  if (existing) return existing;
  const created = randomHex(32);
  await SecureStore.setItemAsync(key, created, OPTIONS);
  return created;
}

export async function getAppLockEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync('app_lock', OPTIONS)) !== 'off';
}

export async function setAppLockEnabled(enabled: boolean) {
  await SecureStore.setItemAsync('app_lock', enabled ? 'on' : 'off', OPTIONS);
}

// Boton de panico: borra la identidad, las prekeys, la llave de la base de datos y la sesion de este usuario
export async function wipeAccountKeys(username: string) {
  const u = userKey(username);
  for (const key of [`id2_${u}`, `spk_${u}`, `dbkey_${u}`, 'auth_session']) {
    await SecureStore.deleteItemAsync(key, OPTIONS).catch(() => {});
  }
}

// Llaves del protocolo viejo (v1), para borrarlas despues de migrar
export async function deleteLegacyKeys(username: string, peers: string[]) {
  const keys = [`identity_${username}`, ...peers.map((p) => `ratchet_${username}_${p}`)];
  for (const key of keys) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // nombres con caracteres que SecureStore no acepta: nunca se pudieron guardar
    }
  }
}
