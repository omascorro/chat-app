// Pruebas de la app completa: dos telefonos (procesos con el ChatClient real) hablando por el servidor real.
// Uso: npm run test:client   (necesita la carpeta chat-backend al lado de chat-app, o AETERNA_BACKEND_DIR)
import assert from 'node:assert/strict';
import { Device, startServer, waitFor } from './harness/world';

type Msg = {
  id: string; fromMe: boolean; kind: string; body: string; status: string; deleted: boolean; editedAt: number | null;
  reactions: Record<string, string>; replyTo: string | null; downloadState: string; hasFile: boolean;
  viewOnce: boolean; viewed: boolean; ttl: number | null; expiresAt: number | null; sentAt: number;
};

const tests: { name: string; fn: () => Promise<void> }[] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push({ name, fn });

let serverUrl = '';
let counter = 0;

// Dos telefonos nuevos, registrados y con el otro como contacto
async function pair(): Promise<[Device, Device, string, string]> {
  counter++;
  const [na, nb] = [`ana${counter}`, `beto${counter}`];
  const a = new Device(na, serverUrl);
  const b = new Device(nb, serverUrl);
  await Promise.all([a.ready, b.ready]);
  await Promise.all([a.run('boot'), b.run('boot')]);
  await a.run('register', na, 'clave-segura-1');
  await b.run('register', nb, 'clave-segura-2');
  const added = await a.run('addContact', nb);
  assert.ok(added.success, 'agregar contacto');
  await a.run('waitContact', nb);
  return [a, b, na, nb];
}

const msgs = (d: Device, peer: string) => d.run<Msg[]>('messages', peer);
const bodies = (list: Msg[]) => list.filter((m) => m.kind !== 'system').map((m) => m.body);

test('un mensaje llega cifrado de un telefono al otro y se marca como enviado', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'hola beto');
  await waitFor('llega a beto', () => msgs(b, na), (l) => bodies(l).includes('hola beto'));
  await waitFor('ana lo ve enviado', () => msgs(a, nb), (l) => l.some((m) => m.body === 'hola beto' && m.status !== 'pending'));
  await Promise.all([a.close(), b.close()]);
});

const count = (list: Msg[], body: string) => list.filter((m) => m.body === body).length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('si el otro esta sin conexion, recibe todo al volver, en orden y una sola vez', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('offline', true);
  for (const t of ['uno', 'dos', 'tres']) await a.run('sendText', nb, t);
  await waitFor('ana ve los 3 enviados', () => msgs(a, nb), (l) => l.filter((m) => m.fromMe && m.status === 'sent').length === 3);
  await b.run('offline', false);
  const got = await waitFor('beto recibe los 3', () => msgs(b, na), (l) => bodies(l).length === 3);
  assert.deepEqual(bodies(got), ['uno', 'dos', 'tres']);
  await Promise.all([a.close(), b.close()]);
});

test('si se corta la conexion justo al mandar, el mensaje llega una sola vez', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'justo antes del corte');
  await a.run('dropConnection');
  await waitFor('beto lo recibe', () => msgs(b, na), (l) => count(l, 'justo antes del corte') === 1);
  await waitFor('ana lo ve enviado', () => msgs(a, nb), (l) => l.some((m) => m.body === 'justo antes del corte' && (m.status === 'sent' || m.status === 'read')));
  await sleep(1500);
  assert.equal(count(await msgs(b, na), 'justo antes del corte'), 1, 'no se duplica');
  await Promise.all([a.close(), b.close()]);
});

test('si se pierde el ACK, la reentrega del servidor no duplica ni rompe el cifrado', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('dropAcks', true);
  await a.run('sendText', nb, 'sin ack');
  await waitFor('beto lo recibe', () => msgs(b, na), (l) => count(l, 'sin ack') === 1);
  await b.run('dropAcks', false);
  await b.run('dropConnection'); // al reconectar, el servidor lo vuelve a mandar
  await sleep(1500);
  await a.run('sendText', nb, 'despues');
  const l = await waitFor('llega el siguiente', () => msgs(b, na), (x) => count(x, 'despues') === 1);
  assert.equal(count(l, 'sin ack'), 1, 'la reentrega no duplica');
  assert.ok(!l.some((m) => m.kind === 'system' && /descifrar/.test(m.body)), 'no hay errores de descifrado');
  await Promise.all([a.close(), b.close()]);
});

test('una subida colgada no bloquea los textos, y la foto sale al recuperarse', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('hangUploads', true);
  await a.run('sendImage', nb);
  await a.run('sendText', nb, 'texto despues de la foto');
  await waitFor('el texto llega aunque la foto este colgada', () => msgs(b, na), (l) => count(l, 'texto despues de la foto') === 1);
  const diag = await waitFor('diagnostico muestra el error', () => a.run('diagnostics'), (d: any) => d.outbox.some((o: any) => /tard/.test(o.lastError ?? '')));
  assert.ok(diag.outbox.length >= 1);
  await a.run('hangUploads', false);
  await waitFor('la foto llega y se descarga', () => msgs(b, na), (l) => l.some((m) => m.kind === 'image' && m.downloadState === 'done' && m.hasFile));
  await Promise.all([a.close(), b.close()]);
});

test('muchos mensajes en ambos sentidos con cortes al azar: todos llegan una vez y en orden', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('sendText', na, 'hola de vuelta');
  await waitFor('sesion en ambos sentidos', () => msgs(a, nb), (l) => count(l, 'hola de vuelta') === 1);
  const sentA: string[] = [];
  const sentB: string[] = [];
  for (let i = 0; i < 12; i++) {
    sentA.push(`a${i}`);
    sentB.push(`b${i}`);
    await Promise.all([a.run('sendText', nb, `a${i}`), b.run('sendText', na, `b${i}`)]);
    if (i % 4 === 1) await a.run('dropConnection');
    if (i % 5 === 2) await b.run('dropConnection');
  }
  const atB = await waitFor('beto recibe todo', () => msgs(b, na), (l) => sentA.every((t) => count(l, t) === 1), 20000);
  const atA = await waitFor('ana recibe todo', () => msgs(a, nb), (l) => sentB.every((t) => count(l, t) === 1), 20000);
  assert.deepEqual(atB.filter((m) => !m.fromMe && m.body.startsWith('a')).map((m) => m.body), sentA, 'orden de ana');
  assert.deepEqual(atA.filter((m) => !m.fromMe && /^b\d/.test(m.body)).map((m) => m.body), sentB, 'orden de beto');
  await Promise.all([a.close(), b.close()]);
});

test('responder, editar, reaccionar, borrar para todos y confirmacion de lectura', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'original');
  const [orig] = (await waitFor('llega', () => msgs(b, na), (l) => count(l, 'original') === 1)).filter((m) => m.body === 'original');
  await waitFor('ana ve leido (beto tiene el chat abierto)', () => msgs(a, nb), (l) => l.some((m) => m.body === 'original' && m.status === 'read'));
  await b.run('sendText', na, 'respuesta', orig.id);
  const la = await waitFor('llega la respuesta', () => msgs(a, nb), (l) => count(l, 'respuesta') === 1);
  assert.equal(la.find((m) => m.body === 'respuesta')!.replyTo, orig.id);
  await a.run('edit', nb, orig.id, 'editado');
  await waitFor('beto ve la edicion', () => msgs(b, na), (l) => l.some((m) => m.id === orig.id && m.body === 'editado' && m.editedAt));
  await b.run('react', na, orig.id, '🔥');
  await waitFor('ana ve la reaccion', () => msgs(a, nb), (l) => l.some((m) => m.id === orig.id && m.reactions[nb] === '🔥'));
  await a.run('deleteForEveryone', nb, orig.id);
  await waitFor('se borra para beto', () => msgs(b, na), (l) => l.some((m) => m.id === orig.id && m.deleted));
  await Promise.all([a.close(), b.close()]);
});

test('los mensajes temporales se sincronizan y se borran en los dos telefonos', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('setTimer', nb, 1);
  await waitFor('beto recibe el ajuste', () => b.run('state'), (s: any) => s.timers[na] === 1);
  await a.run('sendText', nb, 'me borro');
  await waitFor('llega con duracion', () => msgs(b, na), (l) => l.some((m) => m.body === 'me borro' && m.ttl === 1));
  await waitFor('se borra en ana', () => msgs(a, nb), (l) => count(l, 'me borro') === 0, 6000);
  await waitFor('se borra en beto', () => msgs(b, na), (l) => count(l, 'me borro') === 0, 6000);
  await Promise.all([a.close(), b.close()]);
});

test('foto de ver una vez: se borra en los dos al abrirla', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendImage', nb, true);
  const [photo] = (await waitFor('beto la descarga', () => msgs(b, na), (l) => l.some((m) => m.viewOnce && m.downloadState === 'done'))).filter((m) => m.viewOnce);
  await b.run('viewOnce', na, photo.id);
  await waitFor('beto ya no tiene el archivo', () => msgs(b, na), (l) => l.some((m) => m.id === photo.id && m.viewed && !m.hasFile));
  await waitFor('ana la ve abierta', () => msgs(a, nb), (l) => l.some((m) => m.id === photo.id && m.viewed && !m.hasFile));
  await Promise.all([a.close(), b.close()]);
});

test('si cambia la llave de un contacto, los envios esperan hasta aceptarla', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'antes');
  await waitFor('llega', () => msgs(b, na), (l) => count(l, 'antes') === 1);
  await b.run('call', 'panicWipe'); // beto borra todo: al volver tiene una identidad nueva
  await b.run('relogin', nb, 'clave-segura-2');
  await waitFor('ana ve la llave cambiada', () => a.run('state'), (s: any) => s.contacts.some((c: any) => c.username === nb && c.identityChanged));
  await a.run('sendText', nb, 'despues del cambio');
  await sleep(1500);
  assert.equal(count(await msgs(b, na), 'despues del cambio'), 0, 'no sale sin aceptar');
  await a.run('call', 'acceptIdentity', nb);
  await waitFor('sale al aceptar', () => msgs(b, na), (l) => count(l, 'despues del cambio') === 1);
  await Promise.all([a.close(), b.close()]);
});

test('"escribiendo" llega al otro y se quita solo', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'hola');
  await waitFor('contactos mutuos', () => b.run('state'), (s: any) => s.contacts.some((c: any) => c.username === na));
  await a.run('typing', nb, 'start');
  await waitFor('beto ve escribiendo', () => b.run('state'), (s: any) => s.typing[na] === 'typing');
  await a.run('typing', nb, 'stop');
  await waitFor('se quita', () => b.run('state'), (s: any) => !s.typing[na]);
  await Promise.all([a.close(), b.close()]);
});

(async () => {
  const { url } = await startServer();
  console.log = () => {}; // el servidor escribe mucho; los resultados van por stdout directo
  const out = (s: string) => process.stdout.write(s + '\n');
  serverUrl = url;
  const only = process.argv[2]; // npm run test:client -- "parte del nombre"
  const selected = only ? tests.filter((t) => t.name.includes(only)) : tests;
  let failed = 0;
  for (const t of selected) {
    const start = Date.now();
    try {
      await t.fn();
      out(`ok - ${t.name} (${Date.now() - start} ms)`);
    } catch (e) {
      failed++;
      out(`FALLA - ${t.name}\n${String((e as Error)?.stack ?? e)}`);
    }
  }
  out(failed ? `\n${failed} de ${selected.length} pruebas fallaron` : `\n${selected.length} pruebas pasaron`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
