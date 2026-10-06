// Levanta el servidor real (chat-backend/server.js) con una base PostgreSQL en memoria y un almacenamiento
// de archivos falso, y crea "telefonos" de prueba (procesos con device.ts).
import { ChildProcess, fork } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import Module from 'node:module';
import net from 'node:net';
import path from 'node:path';

export const BACKEND_DIR = process.env.AETERNA_BACKEND_DIR ?? path.resolve(__dirname, '../../../chat-backend');

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

// Supabase Storage falso: guarda en memoria lo que sube el servidor
// Archivos que el servidor pidio borrar a Supabase
export const deletedObjects = new Set<string>();

function fakeStorage(port: number) {
  const stored = new Map<string, Buffer>();
  deletedObjects.clear();
  http
    .createServer((req, res) => {
      const up = req.url!.match(/^\/storage\/v1\/object\/(videos|voices)\/(.+)$/);
      const down = req.url!.match(/^\/storage\/v1\/object\/authenticated\/(videos|voices)\/(.+)$/);
      if (req.method === 'POST' && up) {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          stored.set(`${up[1]}/${up[2]}`, Buffer.concat(chunks));
          res.writeHead(200).end('{}');
        });
        return;
      }
      if (req.method === 'GET' && down) {
        const data = stored.get(`${down[1]}/${down[2]}`);
        if (!data) return res.writeHead(400).end('{}');
        return res.writeHead(200, { 'content-length': data.length }).end(data);
      }
      const del = req.url!.match(/^\/storage\/v1\/object\/(videos|voices)$/);
      if (req.method === 'DELETE' && del) {
        // Se anota lo borrado (sin quitarlo del mapa, para poder revisar los tamaños despues)
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          for (const p of JSON.parse(Buffer.concat(chunks).toString() || '{}').prefixes ?? []) deletedObjects.add(`${del[1]}/${p}`);
          res.writeHead(200).end('[]');
        });
        return;
      }
      if (req.method === 'POST' && req.url!.startsWith('/storage/v1/object/list/')) return res.writeHead(200).end('[]');
      res.writeHead(404).end();
    })
    .listen(port);
  return stored;
}

export async function startServer(): Promise<{ url: string; storage: Map<string, Buffer> }> {
  const serverFile = path.join(BACKEND_DIR, 'server.js');
  if (!fs.existsSync(serverFile)) throw new Error(`No encontre el servidor en ${serverFile} (usa AETERNA_BACKEND_DIR)`);
  const [port, storagePort] = [await freePort(), await freePort()];
  const storage = fakeStorage(storagePort);
  process.env.PORT = String(port);
  process.env.SUPABASE_URL = `http://127.0.0.1:${storagePort}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_prueba';
  delete process.env.DB_CA_CERT;

  // 'pg' -> pg-mem (con traducciones para lo que pg-mem no soporta)
  const { newDb } = require('pg-mem');
  const db = newDb();
  db.public.registerFunction({ name: 'now', returns: 'timestamp', implementation: () => new Date(), impure: true });
  const adapter = db.adapters.createPg();
  class Pool extends adapter.Pool {
    constructor() {
      super();
    }
    on() {
      return this;
    }
    query(text: string, params?: unknown[]) {
      const m = typeof text === 'string' && text.match(/= ANY\(\$(\d)::(int|bigint)\[\]\)/);
      if (m && params) {
        const idx = Number(m[1]) - 1;
        const ids = params[idx] as unknown[];
        const before = params.slice(0, idx);
        const placeholders = ids.map((_, i) => '$' + (before.length + i + 1)).join(', ');
        return super.query(text.replace(m[0], `IN (${placeholders})`), [...before, ...ids.map(Number)]);
      }
      if (typeof text === 'string' && text.includes('INTERVAL')) return Promise.resolve({ rows: [], rowCount: 0 });
      return super.query(text, params);
    }
  }
  const originalLoad = (Module as any)._load;
  (Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === 'pg') return { ...adapter, Pool };
    return originalLoad.apply(this, [request, parent, isMain]);
  };
  // El servidor escribe mucho en consola; en las pruebas se silencia
  const log = console.log;
  console.log = () => {};
  // Expo push falso: se guarda cada notificacion que el servidor manda y todas se aceptan
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.startsWith('https://exp.host/')) {
      const body = JSON.parse(init?.body ?? '{}');
      if (url.endsWith('/push/send')) {
        pushes.push(body);
        return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-' + pushes.length } }));
      }
      const data = Object.fromEntries((body.ids ?? []).map((id: string) => [id, { status: 'ok' }]));
      return new Response(JSON.stringify({ data }));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  require(serverFile);
  await new Promise((r) => setTimeout(r, 1200));
  console.log = log;
  return { url: `ws://127.0.0.1:${port}`, storage };
}

// Notificaciones que el servidor le pidio a Expo enviar
export const pushes: any[] = [];

export class Device {
  private proc: ChildProcess;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  readonly ready: Promise<void>;

  constructor(readonly name: string, serverUrl: string) {
    this.proc = fork(path.join(__dirname, 'device.ts'), [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, AETERNA_TEST_SERVER: serverUrl, AETERNA_DEVICE_NAME: name },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    this.ready = new Promise((resolve) => {
      this.proc.once('message', () => resolve());
    });
    this.proc.on('message', (msg: any) => {
      if (msg.ready) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(`[${this.name}] ${msg.error}`));
    });
  }

  run<T = any>(cmd: string, ...args: unknown[]): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      // Una orden que no responde falla con su nombre en vez de dejar la prueba colgada para siempre
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[${this.name}] la orden "${cmd}" ${cmd === 'call' ? String(args[0]) : ''} no respondio en 60 s`));
      }, 60_000);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.proc.send({ id, cmd, args });
    });
  }

  async close() {
    await this.run('exit').catch(() => {});
  }
}

export async function waitFor<T>(what: string, fn: () => Promise<T>, pred: (v: T) => boolean, ms = 10000): Promise<T> {
  const start = Date.now();
  let last: T;
  for (;;) {
    last = await fn();
    if (pred(last)) return last;
    if (Date.now() - start > ms) throw new Error(`Tiempo agotado esperando: ${what}\nUltimo valor: ${JSON.stringify(last).slice(0, 800)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
