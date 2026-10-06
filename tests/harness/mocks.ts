// Reemplaza los modulos nativos de Expo/React Native por versiones de Node, para correr el codigo real de la app
// (src/lib) fuera del telefono. Cada "telefono" de prueba es un proceso con su propia carpeta y su propia base.
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aeterna-device-'));
const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));
const toUri = (p: string) => 'file://' + p.replace(/\\/g, '/') + (p.endsWith('/') ? '' : '');
const documentDirectory = toUri(path.join(root, 'doc')) + '/';
const cacheDirectory = toUri(path.join(root, 'cache')) + '/';

export const control = {
  hangUploads: false, // simula una subida que se queda colgada
  uploads: 0,
  pushGranted: false, // el usuario dio permiso de notificaciones
};

// ---- expo-sqlite sobre node:sqlite ----
const databases = new Map<string, DatabaseSync>();
function normalize(params: unknown[]): any[] {
  const list = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  return list.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
}
function wrapDb(db: DatabaseSync) {
  const api = {
    execAsync: async (sql: string) => {
      if (/^\s*PRAGMA key/i.test(sql)) return; // SQLCipher: en la prueba no hay cifrado de disco
      db.exec(sql);
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = db.prepare(sql).run(...normalize(params));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getAllAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).all(...normalize(params)),
    getFirstAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).get(...normalize(params)) ?? null,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    closeAsync: async () => {},
  };
  return api;
}
const expoSqlite = {
  openDatabaseAsync: async (name: string) => {
    if (!databases.has(name)) databases.set(name, new DatabaseSync(':memory:'));
    return wrapDb(databases.get(name)!);
  },
  deleteDatabaseAsync: async (name: string) => {
    databases.delete(name);
  },
};

// ---- expo-file-system/legacy sobre node:fs ----
const EncodingType = { UTF8: 'utf8', Base64: 'base64' };
const fileSystem = {
  documentDirectory,
  cacheDirectory,
  EncodingType,
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  readAsStringAsync: async (uri: string, opts?: { encoding?: string }) =>
    fs.readFileSync(toPath(uri)).toString(opts?.encoding === 'base64' ? 'base64' : 'utf8'),
  writeAsStringAsync: async (uri: string, data: string, opts?: { encoding?: string }) => {
    fs.mkdirSync(path.dirname(toPath(uri)), { recursive: true });
    fs.writeFileSync(toPath(uri), Buffer.from(data, opts?.encoding === 'base64' ? 'base64' : 'utf8'));
  },
  getInfoAsync: async (uri: string) => {
    try {
      const st = fs.statSync(toPath(uri));
      return { exists: true, isDirectory: st.isDirectory(), size: st.size, uri };
    } catch {
      return { exists: false, isDirectory: false, uri };
    }
  },
  makeDirectoryAsync: async (uri: string) => {
    fs.mkdirSync(toPath(uri), { recursive: true });
  },
  deleteAsync: async (uri: string) => {
    fs.rmSync(toPath(uri), { recursive: true, force: true });
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    fs.mkdirSync(path.dirname(toPath(to)), { recursive: true });
    fs.renameSync(toPath(from), toPath(to));
  },
  readDirectoryAsync: async (uri: string) => fs.readdirSync(toPath(uri)),
  uploadAsync: async (url: string, fileUri: string, opts: { httpMethod?: string; headers?: Record<string, string> }) => {
    control.uploads++;
    if (control.hangUploads) return new Promise(() => {}); // nunca termina
    const res = await fetch(url, { method: opts.httpMethod ?? 'POST', headers: opts.headers, body: fs.readFileSync(toPath(fileUri)) });
    return { status: res.status, body: await res.text(), headers: {}, mimeType: null };
  },
  downloadAsync: async (url: string, fileUri: string, opts?: { headers?: Record<string, string> }) => {
    const res = await fetch(url, { headers: opts?.headers });
    if (res.ok) {
      fs.mkdirSync(path.dirname(toPath(fileUri)), { recursive: true });
      fs.writeFileSync(toPath(fileUri), Buffer.from(await res.arrayBuffer()));
    }
    return { status: res.status, uri: fileUri, headers: {}, mimeType: null };
  },
};

// ---- llavero y almacenamiento sencillo en memoria ----
const secure = new Map<string, string>();
const secureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (k: string) => secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    secure.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    secure.delete(k);
  },
};
const asyncMap = new Map<string, string>();
const asyncStorage = {
  getItem: async (k: string) => asyncMap.get(k) ?? null,
  setItem: async (k: string, v: string) => {
    asyncMap.set(k, v);
  },
  removeItem: async (k: string) => {
    asyncMap.delete(k);
  },
};

// ---- React Native y el resto ----
const appStateListeners: ((s: string) => void)[] = [];
export const appState = {
  set(next: string) {
    reactNative.AppState.currentState = next;
    appStateListeners.forEach((l) => l(next));
  },
};
const reactNative = {
  AppState: {
    currentState: 'active',
    addEventListener: (_: string, cb: (s: string) => void) => {
      appStateListeners.push(cb);
      return { remove() {} };
    },
  },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: <T>(s: T) => s, hairlineWidth: 1 },
};

const esm = <T extends object>(mod: T) => ({ __esModule: true, default: mod, ...mod });

const MOCKS: Record<string, unknown> = {
  'react-native': reactNative,
  'expo-sqlite': expoSqlite,
  'expo-file-system/legacy': fileSystem,
  'expo-secure-store': secureStore,
  '@react-native-async-storage/async-storage': esm(asyncStorage),
  'expo-constants': esm({ expoConfig: { extra: { eas: { projectId: 'prueba' } } } }),
  'expo-task-manager': { defineTask: () => {} },
  'expo-notifications': {
    AndroidImportance: { MAX: 5 },
    AndroidNotificationVisibility: { PRIVATE: 2 },
    registerTaskAsync: async () => {},
    scheduleNotificationAsync: async () => 'id',
    setNotificationChannelAsync: async () => {},
    getPermissionsAsync: async () => ({ status: control.pushGranted ? 'granted' : 'denied', canAskAgain: false }),
    requestPermissionsAsync: async () => ({ status: control.pushGranted ? 'granted' : 'denied' }),
    getExpoPushTokenAsync: async () => ({ data: `ExponentPushToken[${process.env.AETERNA_DEVICE_NAME ?? 'prueba'}]` }),
    addPushTokenListener: () => ({ remove() {} }),
  },
  'expo-image-manipulator': {
    SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
    manipulateAsync: async (uri: string, _actions: unknown, opts?: { base64?: boolean }) => {
      const out = toUri(path.join(root, 'cache', `manip-${Math.random().toString(36).slice(2)}.png`));
      fs.mkdirSync(path.dirname(toPath(out)), { recursive: true });
      fs.copyFileSync(toPath(uri), toPath(out));
      return { uri: out, width: 512, height: 512, base64: opts?.base64 ? fs.readFileSync(toPath(out)).toString('base64') : undefined };
    },
  },
};

const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request in MOCKS) return MOCKS[request];
  return originalLoad.apply(this, [request, parent, isMain]);
};

(globalThis as any).__DEV__ = false;
(globalThis as any).WebSocket = require('ws');

export function makeTestFile(name: string, bytes: Buffer): string {
  const p = path.join(root, 'cache', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return toUri(p);
}

export function fileExists(uri: string | null): boolean {
  return !!uri && fs.existsSync(toPath(uri));
}

export function cleanup() {
  fs.rmSync(root, { recursive: true, force: true });
}
