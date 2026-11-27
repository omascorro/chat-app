// Pruebas de la app completa: dos telefonos (procesos con el ChatClient real) hablando por el servidor real.
// Uso: npm run test:client   (necesita la carpeta chat-backend al lado de chat-app, o AETERNA_BACKEND_DIR)
import assert from 'node:assert/strict';
import { deletedObjects, Device, pushes, serverDb, startServer, waitFor } from './harness/world';

type Msg = {
  id: string; fromMe: boolean; kind: string; body: string; status: string; deleted: boolean; editedAt: number | null;
  reactions: Record<string, string>; replyTo: string | null; downloadState: string; hasFile: boolean;
  viewOnce: boolean; viewed: boolean; ttl: number | null; expiresAt: number | null; sentAt: number;
};

const tests: { name: string; fn: () => Promise<void> }[] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push({ name, fn });

let serverUrl = '';
let storage: Map<string, Buffer> = new Map(); // lo que el servidor guarda en Supabase (falso)
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

test('fijar un mensaje se sincroniza con el otro telefono (maximo 3) y desfijar tambien', async () => {
  const [a, b, na, nb] = await pair();
  for (const t of ['p1', 'p2', 'p3', 'p4']) await a.run('sendText', nb, t);
  const atA = await waitFor('ana ve sus 4', () => msgs(a, nb), (l) => ['p1', 'p2', 'p3', 'p4'].every((t) => count(l, t) === 1));
  await waitFor('beto recibe los 4', () => msgs(b, na), (l) => ['p1', 'p2', 'p3', 'p4'].every((t) => count(l, t) === 1));
  const id = (body: string) => atA.find((m) => m.body === body)!.id;
  for (const t of ['p1', 'p2', 'p3', 'p4']) await a.run('call', 'setPinned', nb, id(t), true);
  const expected = [id('p4'), id('p3'), id('p2')]; // el mas reciente primero; p1 sale por el limite de 3
  await waitFor('ana tiene 3 fijados', () => a.run('state'), (s: any) => JSON.stringify(s.pins[nb]) === JSON.stringify(expected));
  await waitFor('beto tiene los mismos', () => b.run('state'), (s: any) => JSON.stringify(s.pins[na]) === JSON.stringify(expected));
  await b.run('call', 'setPinned', na, id('p3'), false);
  await waitFor('ana ve que beto desfijo p3', () => a.run('state'), (s: any) => !s.pins[nb].includes(id('p3')));
  // Un fijado que se borra para todos desaparece de los fijados
  await a.run('deleteForEveryone', nb, id('p4'));
  await waitFor('beto ya no lo tiene fijado', async () => {
    await msgs(b, na);
    return b.run('state');
  }, (s: any) => !s.pins[na].includes(id('p4')));
  await Promise.all([a.close(), b.close()]);
});

test('la busqueda encuentra texto en todas las conversaciones, sin borrados ni avisos del sistema', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'La reunión es el Viernes en la mañana');
  await a.run('sendText', nb, 'otro tema');
  await a.run('sendText', nb, 'porcentaje 100% seguro');
  await waitFor('beto recibe', () => msgs(b, na), (l) => bodies(l).length === 3);
  const results = await b.run<Msg[]>('call', 'searchAll', 'viernes');
  assert.deepEqual(results.map((m) => m.body), ['La reunión es el Viernes en la mañana'], 'sin distinguir mayusculas');
  const accents = await b.run<Msg[]>('call', 'searchAll', 'REUNION manana');
  assert.equal(accents.length, 0, 'las palabras deben ir juntas como en el texto');
  assert.equal((await b.run<Msg[]>('call', 'searchAll', 'reunion')).length, 1, 'sin acentos encuentra con acentos');
  assert.equal((await b.run<Msg[]>('call', 'searchAll', 'la mañana')).length, 1, 'con ñ');
  assert.equal((await b.run<Msg[]>('call', 'searchAll', 'la manana')).length, 1, 'sin ñ encuentra con ñ');
  const pct = await b.run<Msg[]>('call', 'searchAll', '100%');
  assert.deepEqual(pct.map((m) => m.body), ['porcentaje 100% seguro'], 'el % se busca literal');
  assert.equal((await b.run<Msg[]>('call', 'searchAll', 'x')).length, 0, 'minimo 2 letras');
  const del = (await msgs(a, nb)).find((m) => m.body === 'otro tema')!;
  await a.run('deleteForEveryone', nb, del.id);
  await waitFor('se borra en beto', () => msgs(b, na), (l) => l.some((m) => m.id === del.id && m.deleted));
  assert.equal((await b.run<Msg[]>('call', 'searchAll', 'otro tema')).length, 0, 'los borrados no aparecen');
  await Promise.all([a.close(), b.close()]);
});

test('borrar una foto: para todos la quita de los dos telefonos (con su archivo) y para mi solo del mio', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendImage', nb);
  await a.run('sendImage', nb);
  const photos = (await waitFor('beto descarga las 2 fotos', () => msgs(b, na), (l) => l.filter((m) => m.kind === 'image' && m.hasFile).length === 2))
    .filter((m) => m.kind === 'image');
  // La foto que ve beto es identica a la original (el relleno se quita al descifrar)
  assert.equal(await b.run('decryptMedia', na, photos[1].id), await b.run('testPng'), 'la foto se descifra igual a la original');
  // Lo que guarda el servidor no revela el tamaño real: mide un escalon de relleno (16 KB) mas el cifrado
  const sizes = [...storage.values()].map((v) => v.length);
  assert.ok(sizes.length > 0 && sizes.every((n) => (n - 16) % (16 * 1024) === 0), `tamaños con relleno: ${sizes.join(', ')}`);
  await a.run('deleteForEveryone', nb, photos[0].id);
  await waitFor('se borra en beto con su archivo', () => msgs(b, na), (l) => l.some((m) => m.id === photos[0].id && m.deleted && !m.hasFile));
  const atA = await msgs(a, nb);
  assert.ok(atA.some((m) => m.id === photos[0].id && m.deleted && !m.hasFile), 'y en ana tambien');
  await b.run('call', 'deleteForMe', photos[1].id);
  assert.ok(!(await msgs(b, na)).some((m) => m.id === photos[1].id), 'beto la borro para el');
  await sleep(500);
  assert.ok((await msgs(a, nb)).some((m) => m.id === photos[1].id && !m.deleted && m.hasFile), 'ana la conserva');
  await Promise.all([a.close(), b.close()]);
});

test('las fotos solo las bajan quien las mando y quien las recibe; borrar para todos las quita del servidor', async () => {
  const [a, b, na, nb] = await pair();
  const c = new Device(`carlos${counter}`, serverUrl);
  await c.ready;
  await c.run('boot');
  await c.run('register', `carlos${counter}`, 'clave-segura-3');
  await b.run('offline', true); // beto no la descarga todavia (al descargarla se borra del servidor)
  await a.run('sendImage', nb);
  const photo = await waitFor('la foto se sube', () => msgs(a, nb), (l) => l.some((m) => m.kind === 'image' && m.status !== 'pending'));
  const id = photo.find((m) => m.kind === 'image')!.id;
  const media = await a.run<any>('mediaOf', nb, id);
  assert.ok(media?.path, 'la foto tiene su archivo en el servidor');
  assert.equal(await c.run('fetchMedia', media.bucket, media.path), 404, 'un tercero con sesion valida no la puede bajar');
  assert.equal(await a.run('fetchMedia', media.bucket, media.path), 200, 'quien la mando si');
  await c.run('call', 'send', { type: 'media-done', bucket: media.bucket, path: media.path });
  await sleep(300);
  assert.ok(!deletedObjects.has(`${media.bucket}/${media.path}`), 'un tercero tampoco la puede borrar');
  await a.run('deleteForEveryone', nb, id);
  await waitFor('el servidor borra el archivo', async () => deletedObjects.has(`${media.bucket}/${media.path}`), (v) => v);
  await b.run('offline', false);
  await waitFor('beto ve la foto borrada', () => msgs(b, na), (l) => l.some((m) => m.id === id && m.deleted));
  await Promise.all([a.close(), b.close(), c.close()]);
});

test('foto de perfil: el contacto la ve, y la que quedo cifrada se restaura sola', async () => {
  const [a, b, na] = await pair();
  const png = await a.run<string>('testPng');
  assert.ok(await a.run('call', 'updateProfilePicture', png), 'se manda');
  await waitFor('beto ve la foto de ana', () => b.run<any>('state'), (s) => /^[A-Za-z0-9+/]/.test(s.contacts.find((c: any) => c.username === na)?.profilePicture ?? ''));
  // Como la dejo la version anterior: cifrada en el servidor. Ana la descifra y la sube normal otra vez
  await a.run('call', 'send', { type: 'update-profile-picture', profilePicture: await a.run('myEncryptedPicture', png) });
  await waitFor('ana detecta su foto cifrada y la vuelve a subir', () => a.run<boolean>('prop', 'migratingPicture'), (v) => v === true);
  await waitFor('ana la restaura', () => b.run<any[]>('prop', 'serverUsers'), (l) => { const p = l.find((u) => u.username === na)?.profilePicture ?? ''; return !!p && !/^e1:/.test(p); }, 15000);
  await Promise.all([a.close(), b.close()]);
});

test('nota de voz: el otro telefono la descarga y la descifra identica (con relleno)', async () => {
  const [a, b, na, nb] = await pair();
  const original = await a.run<string>('sendVoice', nb, 37_123);
  const got = await waitFor('beto descarga la nota de voz', () => msgs(b, na), (l) => l.some((m) => m.kind === 'voice' && m.hasFile));
  const voice = got.find((m) => m.kind === 'voice')!;
  assert.equal(await b.run('decryptMedia', na, voice.id), original, 'beto escucha exactamente lo que grabo ana');
  const mine = (await msgs(a, nb)).find((m) => m.kind === 'voice')!;
  assert.equal(await a.run('decryptMedia', nb, mine.id), original, 'y ana su propia nota');
  await Promise.all([a.close(), b.close()]);
});

test('notificaciones: con la app en segundo plano llega el aviso, y la prueba de Ajustes reporta el resultado', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('allowPush', true);
  // Al volver a conectar, beto registra su token (antes solo se intentaba una vez por arranque)
  await b.run('dropConnection');
  await waitFor('beto reconecta', () => b.run<any>('state'), (s) => s.connected);
  await sleep(500);
  await b.run('background', true);
  await sleep(300);
  const before = pushes.length;
  await a.run('sendText', nb, 'hola, estas?');
  await waitFor('el servidor manda la notificacion a beto', async () => pushes.slice(before), (l) => l.some((p) => p.to === `ExponentPushToken[${nb}]`));
  const push = pushes.slice(before).find((p) => p.to === `ExponentPushToken[${nb}]`);
  assert.ok(!JSON.stringify(push).includes('hola'), 'la notificacion no lleva el mensaje legible');
  await b.run('background', false);
  // Despues de un rato en segundo plano la app abre otra conexion
  await waitFor('beto reconecta', () => b.run<any>('state'), (s) => s.connected);
  await sleep(300);
  // Prueba desde Ajustes
  await b.run('call', 'testPushNotifications', 0);
  const s = await waitFor('resultado de la prueba', () => b.run<any>('state'), (st) => /^✅/.test(st.pushTest ?? ''), 15000);
  assert.match(s.pushTest, /la aceptaron/);
  // Sin permiso, la prueba lo dice claro
  await a.run('call', 'testPushNotifications', 0);
  const sa = await a.run<any>('state');
  assert.match(sa.pushTest, /desactivadas/);
  await Promise.all([a.close(), b.close()]);
});

test('al volver de segundo plano con la conexion muerta, el mensaje sale de inmediato (no tras esperar la confirmacion)', async () => {
  const [a, b, na, nb] = await pair();
  // Confirmacion lenta como en un telefono real, para que la diferencia se note
  await a.run('timeouts', { accept: 5000 });
  await a.run('background', true);
  await a.run('zombie');
  await sleep(600);
  await a.run('background', false);
  const start = Date.now();
  await a.run('sendText', nb, 'ya volvi');
  await waitFor('beto lo recibe', () => msgs(b, na), (l) => l.some((m) => m.body === 'ya volvi'));
  // Antes: 5 s esperando la confirmacion + 0.8 s de ping antes de reconectar
  assert.ok(Date.now() - start < 3000, `tardo ${Date.now() - start} ms`);
  await Promise.all([a.close(), b.close()]);
});

test('reintento sin confirmacion: el servidor no guarda, entrega ni avisa una segunda copia', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'hola');
  await waitFor('beto recibe hola', () => msgs(b, na), (l) => l.some((m) => m.body === 'hola'));
  await a.run('dropAccepted', 1);
  await a.run('sendText', nb, 'una vez');
  await waitFor('ana lo ve enviado tras reintentar', () => msgs(a, nb), (l) => l.some((m) => m.body === 'una vez' && m.status !== 'pending'));
  await a.run('dropAccepted', 1);
  await a.run('setTimer', nb, 3600);
  await waitFor('beto ve el cambio de temporizador', () => msgs(b, na), (l) => l.some((m) => m.kind === 'system' && /temporales/.test(m.body)));
  await sleep(2500); // tiempo de sobra para que llegara una copia repetida
  const logged = serverDb.public.many(`SELECT * FROM delivery_log WHERE from_username = '${na}'`);
  assert.equal(logged.filter((r: any) => r.recipient_state).length, 2, 'una sola entrega por mensaje (hola y una vez)');
  const timerNotes = (await msgs(b, na)).filter((m) => m.kind === 'system' && /temporales/.test(m.body));
  assert.equal(timerNotes.length, 1, 'el aviso del temporizador no se repite');
  assert.equal((await msgs(b, na)).filter((m) => m.body === 'una vez').length, 1);
  await Promise.all([a.close(), b.close()]);
});

test('si falla guardar un mensaje recibido, no se pierde: el servidor lo vuelve a entregar', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('failStore', 'insertMessage', 1);
  await a.run('sendText', nb, 'no se pierde');
  await sleep(1000);
  assert.ok(!(await msgs(b, na)).some((m) => m.body === 'no se pierde'), 'todavia no se guardo');
  await b.run('dropConnection');
  const l = await waitFor('llega al reconectar', () => msgs(b, na), (x) => x.some((m) => m.body === 'no se pierde'));
  assert.equal(l.filter((m) => m.body === 'no se pierde').length, 1, 'una sola vez');
  assert.ok(!l.some((m) => m.kind === 'system' && /descifrar/.test(m.body)), 'no aparece "no se pudo descifrar"');
  await Promise.all([a.close(), b.close()]);
});

test('si el servidor pide reintentar la sesion mas tarde, la app reintenta sola y los envios salen', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('retryLaterOnNextResume');
  await b.run('dropConnection');
  await sleep(500);
  await b.run('sendText', na, 'despues del bloqueo');
  await waitFor('ana lo recibe', () => msgs(a, nb), (l) => l.some((m) => m.body === 'despues del bloqueo'));
  await Promise.all([a.close(), b.close()]);
});

test('abrir un chat con mas de 500 sin leer: todos quedan como leidos en el otro telefono', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('seedConversation', nb, 510, true);
  await b.run('seedConversation', na, 510, false);
  await b.run('open', na);
  const readCount = async () => (await a.run<any>('call', 'getMessagesByIds', nb, Array.from({ length: 510 }, (_, i) => `lote-${i}`))).filter((m: any) => m.status === 'read').length;
  await waitFor('los 510 en leido', readCount, (n) => n === 510, 15000);
  await Promise.all([a.close(), b.close()]);
});

test('registro de entregas: el servidor anota cuando se escribio, en que estado estaba el otro, el aviso y la confirmacion', async () => {
  const [a, b, na, nb] = await pair();
  const row = (body: string) => async () => {
    const ids = serverDb.public.many(`SELECT * FROM delivery_log WHERE from_username = '${na}' AND to_username = '${nb}' ORDER BY inbox_id`);
    return ids[ids.length - 1] ?? null;
  };
  // Con la app abierta: sin aviso, confirmado al momento
  await a.run('sendText', nb, 'abierta');
  await waitFor('beto lo recibe', () => msgs(b, na), (l) => l.some((m) => m.body === 'abierta'));
  const open = await waitFor('anotado y confirmado', row('abierta'), (r) => !!r?.acked_at);
  assert.equal(open.recipient_state, 'app abierta');
  assert.equal(open.push_at, null, 'sin aviso con la app abierta');
  assert.ok(open.queued_at, 'la app manda cuando se escribio');
  assert.equal(open.sender_background, false);
  // En segundo plano: el aviso queda anotado con su resultado
  await b.run('allowPush', true);
  await b.run('dropConnection');
  await waitFor('beto reconecta', () => b.run<any>('state'), (s) => s.connected);
  await sleep(500);
  await b.run('background', true);
  await sleep(300);
  const first = (await row('')())?.inbox_id;
  await a.run('sendText', nb, 'dormido');
  const bg = await waitFor('aviso anotado', row('dormido'), (r) => r && r.inbox_id !== first && r.push_result === 'ok');
  assert.equal(bg.recipient_state, 'segundo plano');
  assert.ok(bg.push_at);
  // Los avisos de lectura y reacciones (silenciosos) no se anotan
  assert.ok(serverDb.public.many(`SELECT * FROM delivery_log WHERE from_username = '${nb}'`).length === 0, 'nada silencioso');
  await b.run('background', false);
  await Promise.all([a.close(), b.close()]);
});

test('salir de la app con un mensaje en reloj: se manda de una vez por una conexion nueva (en Android los reintentos se congelan)', async () => {
  const [a, b, na, nb] = await pair();
  // Confirmacion y reconexion lentas: en un Android en segundo plano esos temporizadores no corren
  await a.run('timeouts', { accept: 8000, reconnect: 8000 });
  await a.run('zombie');
  await a.run('sendText', nb, 'me sali');
  await sleep(300);
  assert.equal((await msgs(a, nb)).find((m) => m.body === 'me sali')!.status, 'pending', 'sigue con el reloj');
  const start = Date.now();
  await a.run('background', true);
  await waitFor('beto lo recibe', () => msgs(b, na), (l) => l.some((m) => m.body === 'me sali'));
  assert.ok(Date.now() - start < 3000, `tardo ${Date.now() - start} ms`);
  await waitFor('ana lo ve enviado', () => msgs(a, nb), (l) => ['sent', 'read'].includes(l.find((m) => m.body === 'me sali')!.status));
  assert.equal((await msgs(b, na)).filter((m) => m.body === 'me sali').length, 1, 'llega una sola vez');
  await a.run('background', false);
  await Promise.all([a.close(), b.close()]);
});

test('con la app bloqueada (huella / Face ID) el chat abierto no marca leido hasta desbloquear', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('open', na);
  await b.run('call', 'setLocked', true);
  await a.run('sendText', nb, 'me ves?');
  await waitFor('beto lo recibe', () => msgs(b, na), (l) => l.some((m) => m.body === 'me ves?'));
  await sleep(800);
  const mine = async () => (await msgs(a, nb)).find((m) => m.body === 'me ves?')!;
  assert.notEqual((await mine()).status, 'read', 'bloqueada no cuenta como leido');
  await b.run('call', 'setLocked', false);
  await waitFor('al desbloquear se marca leido', mine, (m) => m.status === 'read');
  await Promise.all([a.close(), b.close()]);
});

test('notificaciones: si la conexion de la app abierta muere antes de confirmar un mensaje, igual llega el aviso', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('allowPush', true);
  await b.run('dropConnection');
  await waitFor('beto reconecta', () => b.run<any>('state'), (s) => s.connected);
  await sleep(500);
  const toBeto = (from: number) => pushes.slice(from).filter((p) => p.to === `ExponentPushToken[${nb}]`);
  // Mensaje confirmado y despues se corta: no hace falta aviso
  let before = pushes.length;
  await a.run('sendText', nb, 'uno');
  await waitFor('beto recibe uno', () => msgs(b, na), (l) => l.some((m) => m.body === 'uno'));
  await sleep(300);
  await b.run('offline', true);
  await sleep(500);
  assert.equal(toBeto(before).length, 0, 'sin aviso si el telefono ya lo habia guardado');
  await b.run('offline', false);
  await sleep(300);
  // La conexion muere sin que el telefono confirme (perdio la senal): antes no llegaba ningun aviso
  await b.run('dropAcks', true);
  before = pushes.length;
  await a.run('sendText', nb, 'dos');
  await waitFor('el mensaje llega por la conexion', () => msgs(b, na), (l) => l.some((m) => m.body === 'dos'));
  assert.equal(toBeto(before).length, 0, 'con la app abierta no se manda aviso');
  await b.run('offline', true);
  await waitFor('aviso al cerrarse la conexion', async () => toBeto(before), (l) => l.length === 1);
  await b.run('dropAcks', false);
  await b.run('offline', false);
  await Promise.all([a.close(), b.close()]);
});

test('responder a una foto: la cita lleva al mensaje original, y si ya no existe lo dice', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendImage', nb);
  const got = await waitFor('beto recibe la foto', () => msgs(b, na), (l) => l.some((m) => m.kind === 'image' && m.hasFile));
  const photo = got.find((m) => m.kind === 'image')!;
  await b.run('sendText', na, 'que bonita', photo.id);
  const atA = await waitFor('ana recibe la respuesta', () => msgs(a, nb), (l) => l.some((m) => m.body === 'que bonita'));
  assert.equal(atA.find((m) => m.body === 'que bonita')!.replyTo, photo.id, 'la respuesta apunta a la foto');
  await a.run('open', nb);
  assert.equal(await a.run('call', 'jumpToMessage', photo.id), true, 'tocar la cita salta a la foto');
  const found = await a.run<any[]>('call', 'getMessagesByIds', nb, [photo.id, 'no-existe']);
  assert.deepEqual(found.map((m) => m.id), [photo.id], 'encuentra la citada aunque no este cargada');
  await a.run('call', 'deleteForMe', photo.id);
  assert.equal(await a.run('call', 'jumpToMessage', photo.id), false, 'si la borre, avisa que ya no esta');
  await Promise.all([a.close(), b.close()]);
});

test('respaldo cifrado: guarda texto y fotos, se restaura igual y rechaza una contraseña equivocada', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'mi contraseña secreta es 1234');
  await a.run('sendImage', nb);
  const sent = await waitFor('ana manda texto y foto', () => msgs(a, nb), (l) => l.filter((m) => m.status !== 'pending' && m.kind !== 'system').length === 2);
  const text = sent.find((m) => m.kind === 'text')!;
  const photo = sent.find((m) => m.kind === 'image')!;
  const uri = await a.run<string>('call', 'exportBackup', 'respaldo-muy-seguro', true);
  const raw = await a.run<string>('readBackupText', uri);
  assert.ok(!raw.includes('secreta'), 'el archivo del respaldo no tiene el texto legible');
  await a.run('call', 'deleteForMe', text.id);
  await a.run('call', 'deleteForMe', photo.id);
  await assert.rejects(a.run('call', 'importBackup', uri, 'otra-contraseña-mala'), /Contraseña incorrecta/);
  const { restored } = await a.run<{ restored: number }>('call', 'importBackup', uri, 'respaldo-muy-seguro');
  assert.equal(restored, 2, 'se restauran los 2 mensajes');
  const after = await msgs(a, nb);
  assert.ok(after.some((m) => m.id === text.id && m.body === 'mi contraseña secreta es 1234'), 'vuelve el texto');
  assert.equal(await a.run('decryptMedia', nb, photo.id), await a.run('testPng'), 'y la foto, identica');
  await Promise.all([a.close(), b.close()]);
});

// Arma un respaldo cifrado como exportBackup (PBKDF2-SHA512 + secretbox) con el contenido que se le de
function makeBackup(password: string, content: unknown): string {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const nacl = require('tweetnacl') as typeof import('tweetnacl');
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(24);
  const key = crypto.pbkdf2Sync(password, salt, 1000, 32, 'sha512');
  const data = nacl.secretbox(Buffer.from(JSON.stringify(content), 'utf8'), nonce, key);
  const b64 = (x: Uint8Array) => Buffer.from(x).toString('base64');
  return JSON.stringify({ format: 'aeterna-backup', v: 1, salt: b64(salt), iterations: 1000, nonce: b64(nonce), data: b64(data) });
}

test('respaldo restaurado dos veces o alterado: no pisa archivos, no duplica y rechaza entradas invalidas', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'texto del respaldo');
  await a.run('sendImage', nb);
  const sent = await waitFor('salen', () => msgs(a, nb), (l) => l.filter((m) => m.status !== 'pending' && m.kind !== 'system').length === 2);
  const photo = sent.find((m) => m.kind === 'image')!;
  const uri = await a.run<string>('call', 'exportBackup', 'respaldo-muy-seguro', true);
  const filesBefore = await a.run<string[]>('mediaDirFiles');
  // Sin borrar nada: todo ya esta, no se restaura ni se escribe nada nuevo, y la foto sigue abriendo igual
  assert.deepEqual(await a.run('call', 'importBackup', uri, 'respaldo-muy-seguro'), { restored: 0, skipped: 0 });
  assert.deepEqual((await a.run<string[]>('mediaDirFiles')).sort(), filesBefore.sort(), 'no se pisan ni agregan archivos');
  assert.equal(await a.run('decryptMedia', nb, photo.id), await a.run('testPng'));
  assert.equal((await msgs(a, nb)).filter((m) => m.kind === 'image').length, 1, 'sin duplicados');

  // Respaldo alterado (misma contraseña): ids con ruta, adjuntos sin llave, temporales y basura; uno solo es valido
  const key = Buffer.alloc(32, 1).toString('base64');
  const good = { id: 'bueno1', peer: nb, fromMe: true, kind: 'text', body: 'valido', media: null, sentAt: Date.now() - 1000, status: 'sent', reactions: {} };
  const tampered = makeBackup('respaldo-muy-seguro', {
    username: na,
    exportedAt: Date.now(),
    messages: [
      good,
      { ...good, id: '../../fuera', body: 'id con ruta' },
      { ...good, id: 'malo2', kind: 'image', media: { bucket: 'videos', key, nonce: 'x', path: 'a'.repeat(32) + '.bin' } },
      { ...good, id: 'malo3', selfDestruct: true },
      { ...good, id: 'malo4', peer: 'con\nsalto' },
      'basura',
      null,
    ],
    media: { '../../fuera': 'AAAA', bueno1: 'no-es-un-archivo-valido' },
  });
  const tamperedUri = await a.run<string>('writeTestFile', 'alterado.aeb', tampered);
  assert.deepEqual(await a.run('call', 'importBackup', tamperedUri, 'respaldo-muy-seguro'), { restored: 1, skipped: 6 });
  const l = await msgs(a, nb);
  assert.ok(l.some((m) => m.id === 'bueno1' && m.body === 'valido'));
  assert.ok(!l.some((m) => /ruta|malo/.test(m.id + m.body)));
  assert.equal(await a.run('appFileExists', '../fuera.enc'), false);
  // Estructura invalida: no es un respaldo
  const notBackup = await a.run<string>('writeTestFile', 'raro.aeb', JSON.stringify({ format: 'aeterna-backup', v: 1, salt: 1, nonce: 'x', data: 'y', iterations: 1000 }));
  await assert.rejects(a.run('call', 'importBackup', notBackup, 'respaldo-muy-seguro'), /no es un respaldo/);
  await Promise.all([a.close(), b.close()]);
});

test('vista previa del chat (mantener presionado): muestra los mensajes sin marcarlos como leidos', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('open', null);
  await a.run('sendText', nb, 'mensaje uno');
  await a.run('sendText', nb, 'mensaje dos');
  await waitFor('ana ve sus mensajes enviados', () => msgs(a, nb), (l) => l.filter((m) => m.fromMe && m.status === 'sent').length === 2);
  await waitFor('beto los recibe', () => b.run<any>('state'), (st) => st.contacts.some((c: any) => c.username === na && c.unread === 2));
  const preview = await b.run<any[]>('call', 'previewMessages', na);
  assert.deepEqual(preview.filter((m) => m.kind === 'text').map((m) => m.body), ['mensaje uno', 'mensaje dos'], 'se ven en la vista previa');
  await sleep(800);
  const atA = await msgs(a, nb);
  assert.ok(atA.filter((m) => m.fromMe).every((m) => m.status !== 'read'), 'ana no los ve como leidos');
  const st = await b.run<any>('state');
  assert.equal(st.contacts.find((c: any) => c.username === na).unread, 2, 'siguen sin leer para beto');
  await Promise.all([a.close(), b.close()]);
});

test('contestar un sticker con otro sticker; videos de mas de 45 MB se rechazan de una vez; el que recibe sabe el tamaño', async () => {
  const [a, b, na, nb] = await pair();
  const stickerB = await b.run<string>('addSticker');
  await b.run('call', 'sendStickerImage', na, stickerB);
  const got = await waitFor('ana recibe el sticker', () => msgs(a, nb), (l) => l.some((m) => m.kind === 'sticker' && m.hasFile));
  const received = got.find((m) => m.kind === 'sticker')!;
  const stickerA = await a.run<string>('addSticker');
  await a.run('call', 'sendStickerImage', nb, stickerA, { replyTo: received.id });
  const atB = await waitFor('beto recibe la respuesta con sticker', () => msgs(b, na), (l) => l.some((m) => m.kind === 'sticker' && !m.fromMe));
  assert.equal(atB.find((m) => m.kind === 'sticker' && !m.fromMe)!.replyTo, received.id, 'el sticker responde al sticker');
  const media = await b.run<any>('mediaOf', na, atB.find((m) => m.kind === 'sticker' && !m.fromMe)!.id);
  assert.ok(media?.size > 0, 'el mensaje dice cuanto pesa el archivo');
  await assert.rejects(a.run('sendBigVideo', nb, 46), /pesa 46 MB y el máximo es 45 MB/);
  await Promise.all([a.close(), b.close()]);
});

test('nota de voz en segundo plano: al salir de la app no se borra la que esta sonando (las demas si)', async () => {
  const [a, b] = await pair();
  assert.deepEqual(await a.run('wipeKeepsPlaying'), { playing: true, other: false, afterStop: false });
  await Promise.all([a.close(), b.close()]);
});

test('documentos: se mandan cifrados con su nombre, se abren identicos y aparecen en la seccion Documentos', async () => {
  const [a, b, na, nb] = await pair();
  const secret = 'Contrato confidencial: numero de cuenta 123-456';
  await a.run('sendDocument', nb, '../../contrato final.pdf', secret, 'te lo mando firmado');
  const got = await waitFor('beto recibe el documento', () => msgs(b, na), (l) => l.some((m) => m.kind === 'file' && m.hasFile));
  const doc = got.find((m) => m.kind === 'file')!;
  assert.equal(doc.body, 'te lo mando firmado', 'el comentario llega con el documento');
  const opened = await b.run<any>('decryptDocument', na, doc.id);
  assert.ok(!opened.media.name.includes('/') && opened.media.name.endsWith('contrato final.pdf'), `el nombre llega limpio: ${opened.media.name}`);
  assert.equal(opened.text, secret, 'se abre identico');
  assert.ok(opened.file.endsWith('.pdf'), 'se guarda con su extension para abrirlo con otra app');
  assert.equal(opened.media.mime, 'application/pdf');
  assert.equal(opened.media.bytes, Buffer.byteLength(secret), 'trae el tamaño original');
  // El servidor no ve ni el contenido ni el nombre
  for (const stored of storage.values()) {
    assert.ok(!stored.toString('latin1').includes('Contrato') && !stored.toString('latin1').includes('contrato'), 'el servidor no lo puede leer');
  }
  const filesB = await b.run<any[]>('call', 'listFiles', na);
  const filesA = await a.run<any[]>('call', 'listFiles', nb);
  assert.deepEqual([filesB.length, filesA.length], [1, 1], 'aparece en Documentos en los dos telefonos');
  const found = await b.run<any[]>('call', 'searchAll', 'contrato');
  assert.ok(found.some((m) => m.id === doc.id), 'la busqueda encuentra el documento por su nombre');
  const byCaption = await b.run<any[]>('call', 'searchAll', 'firmado');
  assert.ok(byCaption.some((m) => m.id === doc.id), 'y por su comentario');
  // Foto con comentario
  await a.run('sendImageWithCaption', nb, 'mira que bonito atardecer');
  const withPhoto = await waitFor('beto recibe la foto con comentario', () => msgs(b, na), (l) => l.some((m) => m.kind === 'image' && m.hasFile));
  assert.equal(withPhoto.find((m) => m.kind === 'image')!.body, 'mira que bonito atardecer', 'el comentario llega con la foto');
  assert.equal(await b.run('decryptMedia', na, withPhoto.find((m) => m.kind === 'image')!.id), await b.run('testPng'), 'y la foto identica');
  await Promise.all([a.close(), b.close()]);
});

test('vaciar chat: solo en mi telefono, o para los dos (con fotos y fijados)', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'mensaje 1');
  await a.run('sendImage', nb);
  await b.run('sendText', na, 'respuesta 1');
  await waitFor('beto tiene todo', () => msgs(b, na), (l) => count(l, 'mensaje 1') === 1 && l.some((m) => m.kind === 'image' && m.hasFile));
  await waitFor('ana tiene todo', () => msgs(a, nb), (l) => count(l, 'respuesta 1') === 1);
  const first = (await msgs(a, nb)).find((m) => m.body === 'mensaje 1')!;
  await a.run('call', 'setPinned', nb, first.id, true);

  // Solo en el telefono de ana
  await a.run('call', 'clearChat', nb, false);
  const aAfter = await msgs(a, nb);
  assert.equal(aAfter.filter((m) => m.kind !== 'system').length, 0, 'ana ya no tiene mensajes');
  assert.ok(aAfter.some((m) => m.kind === 'system' && /Vaciaste el chat en este/.test(m.body)));
  assert.deepEqual((await a.run('state')).pins[nb], [], 'sin fijados');
  await sleep(800);
  const bStill = await msgs(b, na);
  assert.equal(count(bStill, 'mensaje 1'), 1, 'beto conserva su historial');

  // Para los dos (desde beto)
  await b.run('call', 'clearChat', na, true);
  await waitFor('ana ve el aviso', () => msgs(a, nb), (l) => l.some((m) => m.kind === 'system' && /vació el chat/.test(m.body)));
  const bAfter = await msgs(b, na);
  assert.equal(bAfter.filter((m) => m.kind !== 'system').length, 0, 'beto ya no tiene mensajes');
  assert.ok(!bAfter.some((m) => m.hasFile), 'sin archivos');

  // Lo que llega despues de vaciar se queda
  await a.run('sendText', nb, 'despues de vaciar');
  await waitFor('llega', () => msgs(b, na), (l) => count(l, 'despues de vaciar') === 1);
  await sleep(500);
  assert.equal(count(await msgs(b, na), 'despues de vaciar'), 1);
  await Promise.all([a.close(), b.close()]);
});

// Descifra una vista previa v2 con ChaCha20-Poly1305 estandar (el mismo que usa CryptoKit en la extension del iPhone):
// 0x02 | id 8 bytes | nonce 12 | cifrado | tag 16, con "aeterna-preview-v2:<id>" como dato asociado
function openPreviewV2(keyB64: string, data: string): { kid: string; b: string } {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const raw = Buffer.from(data, 'base64');
  assert.equal(raw[0], 2, 'formato v2');
  const kid = raw.subarray(1, 9).toString('hex');
  const d = crypto.createDecipheriv('chacha20-poly1305', Buffer.from(keyB64, 'base64'), raw.subarray(9, 21), { authTagLength: 16 });
  d.setAAD(Buffer.from(`aeterna-preview-v2:${kid}`, 'utf8'), { plaintextLength: raw.length - 21 - 16 });
  d.setAuthTag(raw.subarray(raw.length - 16));
  return { kid, ...JSON.parse(Buffer.concat([d.update(raw.subarray(21, raw.length - 16)), d.final()]).toString('utf8')) };
}

// La vista previa como la arma la version 1 (una llave para todos los contactos y el remitente dentro del contenido)
function legacyPreview(keyB64: string, preview: { f: string; b: string }): string {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('chacha20-poly1305', Buffer.from(keyB64, 'base64'), nonce, { authTagLength: 16 });
  const body = Buffer.concat([c.update(JSON.stringify(preview), 'utf8'), c.final()]);
  return Buffer.concat([nonce, body, c.getAuthTag()]).toString('base64');
}

test('vista previa de notificaciones: una llave por contacto, el titulo sale del llavero y el servidor no la puede leer', async () => {
  const [a, b, na, nb] = await pair();
  // Un tercero que tambien es contacto de beto
  counter++;
  const nc = `carla${counter}`;
  const c = new Device(nc, serverUrl);
  await c.ready;
  await c.run('boot');
  await c.run('register', nc, 'clave-segura-3');
  assert.ok((await c.run('addContact', nb)).success);
  await b.run('waitContact', nc);
  await b.run('sendText', na, 'hola ana');
  await b.run('sendText', nc, 'hola carla');
  await waitFor('ana recibe', () => msgs(a, nb), (l) => count(l, 'hola ana') === 1);
  await waitFor('carla recibe', () => msgs(c, nb), (l) => count(l, 'hola carla') === 1);
  // Cada contacto de beto recibe una llave distinta (con id distinto)
  const forA = JSON.parse((await waitFor('ana tiene la llave de beto', () => a.run<string | null>('kv', `peer_nk2:${nb}`), (v) => !!v))!);
  const forC = JSON.parse((await waitFor('carla tiene la llave de beto', () => c.run<string | null>('kv', `peer_nk2:${nb}`), (v) => !!v))!);
  assert.notEqual(forA.kid, forC.kid, 'ids distintos');
  assert.notEqual(forA.key, forC.key, 'llaves distintas');
  assert.equal(await b.run('deviceKey'), null, 'la llave unica de la version 1 ya no existe');

  await a.run('spySends');
  await a.run('sendText', nb, 'nos vemos a las 8');
  const sent = await waitFor('ana manda con vista previa', () => a.run<any[]>('sentMessages'), (l) => l.some((m) => m.preview));
  const withPreview = sent.find((m) => m.preview)!;
  assert.deepEqual(openPreviewV2(forA.key, withPreview.preview), { kid: forA.kid, b: 'nos vemos a las 8' });
  assert.ok(!JSON.stringify(withPreview).includes('nos vemos'), 'el texto no viaja en claro');
  assert.deepEqual(await b.run('openPreview', withPreview.preview), { f: na, b: 'nos vemos a las 8' }, 'beto ve que es de ana');
  // Carla no puede abrir lo que ana le manda a beto con su propia llave, ni hacerse pasar por ana
  assert.throws(() => openPreviewV2(forC.key, withPreview.preview), 'la llave de carla no abre la de ana');
  const forged = withPreview.preview.slice(0, 4) + (withPreview.preview[4] === 'A' ? 'B' : 'A') + withPreview.preview.slice(5);
  assert.equal(await b.run('openPreview', forged), null, 'alterada: aviso generico');
  // Formato viejo (llave compartida, remitente dentro del contenido): aviso generico
  assert.equal(await b.run('openPreview', legacyPreview(forA.key, { f: na, b: 'viejo' })), null);

  await a.run('setTimer', nb, 30);
  await a.run('sendText', nb, 'esto es temporal');
  const again = await waitFor('manda el temporal', () => a.run<any[]>('sentMessages'), (l) => l.filter((m) => m.preview).length >= 2);
  const last = again.filter((m) => m.preview).pop()!;
  assert.equal(openPreviewV2(forA.key, last.preview).b, '⏱ Mensaje temporal', 'los temporales no muestran contenido');

  // Retiro: al quitar a ana, su llave se borra del llavero de beto y lo que llegue con ella se ve generico
  await b.run('call', 'removeContact', na);
  await waitFor('llave retirada', () => b.run('secureItem', `pnk2_${forA.kid}`), (v) => v === null);
  assert.equal(await b.run('openPreview', withPreview.preview), null);
  await Promise.all([a.close(), b.close(), c.close()]);
});

test('identidad distinta a la fijada: el mensaje se retiene sin aplicarse ni sustituir la sesion hasta aceptarla', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'antes');
  await waitFor('llega', () => msgs(b, na), (l) => count(l, 'antes') === 1);
  await b.run('sendText', na, 'respuesta');
  await waitFor('llega la respuesta', () => msgs(a, nb), (l) => count(l, 'respuesta') === 1);
  const before = await a.run<any[]>('sessionIdentities', nb);
  assert.ok(before.length > 0 && before.every((x) => x), 'ana tiene sesion con beto');

  await b.run('call', 'panicWipe'); // identidad nueva en el telefono de beto
  await b.run('relogin', nb, 'clave-segura-2');
  await b.run('waitContact', na);
  await b.run('sendText', na, 'desde el telefono nuevo');
  await waitFor('beto lo ve enviado', () => msgs(b, na), (l) => l.some((m) => m.body === 'desde el telefono nuevo' && m.status !== 'pending'));
  await sleep(800);
  const held = await msgs(a, nb);
  assert.equal(count(held, 'desde el telefono nuevo'), 0, 'no se muestra sin aceptar');
  assert.ok((await a.run<number>('countHeld', nb)) >= 1, 'se guardo retenido');
  assert.ok(held.some((m) => m.kind === 'system' && /llave de seguridad distinta/.test(m.body)), 'avisa que hay mensajes retenidos');
  assert.deepEqual(await a.run('sessionIdentities', nb), before, 'la sesion con la identidad vieja sigue igual');
  const s: any = await a.run('state');
  assert.ok(s.contacts.find((c: any) => c.username === nb).identityChanged, 'muestra la llave cambiada');

  await a.run('call', 'acceptIdentity', nb);
  const after = await waitFor('aparece al aceptar', () => msgs(a, nb), (l) => count(l, 'desde el telefono nuevo') === 1);
  assert.equal(count(after, 'desde el telefono nuevo'), 1, 'una sola vez');
  assert.equal(await a.run('countHeld', nb), 0, 'ya no queda retenido');
  // Y la conversacion sigue en los dos sentidos con la sesion nueva
  await a.run('sendText', nb, 'te leo');
  await waitFor('beto recibe', () => msgs(b, na), (l) => count(l, 'te leo') === 1);
  await Promise.all([a.close(), b.close()]);
});

test('un header con datos de otra identidad que no descifra no cambia la llave del contacto', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('sendText', na, 'hola');
  await waitFor('llega', () => msgs(a, nb), (l) => count(l, 'hola') === 1);
  const fake = (n: number) => Buffer.alloc(32, n).toString('base64');
  const header = JSON.stringify({ dh: fake(1), pn: 0, n: 0, pk: { ikSign: fake(2), ikDh: fake(3), ek: fake(4), spkId: 1 } });
  await waitFor('cola de ana vacia', () => a.run<any>('diagnostics'), (d) => d.outbox.length === 0);
  await a.run('spySends');
  await a.run('inject', 'falso-1', nb, { h: header, c: Buffer.alloc(64, 5).toString('base64'), nonce: Buffer.alloc(24, 6).toString('base64') });
  await sleep(800);
  // Antes el header falso cambiaba la llave vista y borraba "ya le mande mis llaves": se le volvian a mandar
  assert.deepEqual(await a.run('sentMessages'), [], 'no se le reenvian llaves por un header falso');
  const s: any = await a.run('state');
  assert.equal(s.contacts.find((c: any) => c.username === nb).identityChanged, false, 'la llave fijada no cambio');
  assert.equal(await a.run('countHeld', nb), 0);
  await b.run('sendText', na, 'sigue funcionando');
  await waitFor('llega', () => msgs(a, nb), (l) => count(l, 'sigue funcionando') === 1);
  await Promise.all([a.close(), b.close()]);
});

test('si falla guardar la sesion al recibir, contenido, recibido y ratchet quedan parejos y nada se repite', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('sendText', nb, 'primero');
  await waitFor('llega', () => msgs(b, na), (l) => count(l, 'primero') === 1);
  // Con el chat cerrado y la cola vacia, el siguiente guardado de sesion es el de la recepcion (no un aviso de leido)
  await b.run('open', null);
  await waitFor('cola de beto vacia', () => b.run<any>('diagnostics'), (d) => d.outbox.length === 0);
  await b.run('failStore', 'saveSessions', 1);
  await a.run('sendText', nb, 'uno');
  await waitFor('queda anotado a medias, sin confirmar al servidor', () => b.run<number>('inboundPending'), (n) => n === 1);
  await a.run('sendText', nb, 'dos');
  await waitFor('lo pendiente se termina antes de usar la sesion', () => b.run<number>('inboundPending'), (n) => n === 0);
  await waitFor('llegan los dos', () => msgs(b, na), (l) => count(l, 'uno') === 1 && count(l, 'dos') === 1);
  await b.run('dropConnection'); // el servidor reentrega "uno" (no se habia confirmado)
  await b.run('sendText', na, 'contesto');
  await waitFor('ana recibe la respuesta', () => msgs(a, nb), (l) => count(l, 'contesto') === 1);
  await sleep(500);
  const l = await msgs(b, na);
  assert.deepEqual(bodies(l), ['primero', 'uno', 'dos', 'contesto'], 'una vez cada uno y en orden');
  assert.ok(!l.some((m) => m.kind === 'system' && /descifrar/.test(m.body)), 'no aparece "no se pudo descifrar"');
  assert.ok(!(await msgs(a, nb)).some((m) => m.kind === 'system' && /descifrar/.test(m.body)));
  await Promise.all([a.close(), b.close()]);
});

test('ids y adjuntos invalidos del otro telefono se descartan sin escribir fuera de la carpeta', async () => {
  const [a, b, na, nb] = await pair();
  const key = Buffer.alloc(32, 1).toString('base64');
  const nonce = Buffer.alloc(24, 2).toString('base64');
  const path = 'a'.repeat(32) + '.bin';
  const now = Date.now();
  const bad = [
    { t: 'msg', id: '../../salir', kind: 'text', body: 'id con ruta', sentAt: now },
    { t: 'msg', id: 'foto1', kind: 'image', sentAt: now, media: { bucket: 'videos', key, nonce, path: '../../../etc/passwd' } },
    { t: 'msg', id: 'foto2', kind: 'image', sentAt: now, media: { bucket: '../otro', key, nonce, path } },
    { t: 'msg', id: 'foto3', kind: 'image', sentAt: now, media: { bucket: 'videos', key: 'corta', nonce, path } },
    { t: 'msg', id: 'foto4', kind: 'image', sentAt: now }, // foto sin archivo
    { t: 'msg', id: 'resp1', kind: 'text', body: 'cita mala', sentAt: now, replyTo: '../x' },
    { t: 'reaction', id: '../../salir', emoji: '👍' },
  ];
  for (const p of bad) await a.run('call', 'queuePayload', nb, p, true);
  await a.run('sendText', nb, 'este si');
  const l = await waitFor('llega el bueno', () => msgs(b, na), (x) => bodies(x).includes('este si'));
  assert.deepEqual(bodies(l).sort(), ['cita mala', 'este si'].sort(), 'solo los validos');
  assert.equal(l.find((m) => m.body === 'cita mala')!.replyTo, null, 'la cita con ruta se quita');
  await sleep(500);
  assert.deepEqual(await b.run('mediaDirFiles'), [], 'no se descargo ni escribio nada');
  assert.equal(await b.run('appFileExists', '../salir.enc'), false);
  await Promise.all([a.close(), b.close()]);
});

test('descargas: se cancelan al pasar el limite de bytes o al vencer el tiempo, sin dejar archivos a medias', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('limits', { maxDownloadBytes: 40 * 1024 });
  await a.run('sendVoice', nb, 100 * 1024); // con relleno y cifrado pesa mas de 40 KB
  await waitFor('beto la da por fallida', () => msgs(b, na), (l) => l.some((m) => m.kind === 'voice' && m.downloadState === 'failed'), 20_000);
  assert.ok((await b.run<any>('downloadStats')).cancelled >= 1, 'se cancelo la descarga nativa');
  assert.deepEqual(await b.run('mediaDirFiles'), [], 'no queda el pedazo descargado');

  // Descarga colgada: al vencer el tiempo se cancela y se borra; al reintentar sin cuelgue, llega completa
  await b.run('limits', { maxDownloadBytes: 50 * 1024 * 1024 });
  await b.run('hangDownloads', true);
  const before = (await b.run<any>('downloadStats')).cancelled;
  const voice = await a.run<string>('sendVoice', nb, 20 * 1024);
  await waitFor('se cancela por tiempo', () => b.run<any>('downloadStats'), (s) => s.cancelled > before, 20_000);
  assert.deepEqual(await b.run('mediaDirFiles'), [], 'sin archivo a medias');
  await b.run('hangDownloads', false);
  const l = await waitFor('llega al reintentar', () => msgs(b, na), (x) => x.filter((m) => m.kind === 'voice').some((m) => m.downloadState === 'done'), 20_000);
  const done = l.filter((m) => m.kind === 'voice').find((m) => m.downloadState === 'done')!;
  assert.equal(await b.run('decryptMedia', na, done.id), voice, 'identica');
  assert.equal((await b.run<string[]>('mediaDirFiles')).length, 1, 'solo la copia completa');
  await Promise.all([a.close(), b.close()]);
});

test('historial completo: la lupa busca en todos los dias, al subir se cargan los anteriores y fotos y videos en la info', async () => {
  const [a, b, na, nb] = await pair();
  // 1200 mensajes de dias pasados (uno por hora desde hace 3 dias) + uno de hoy
  await b.run('seedHistory', na, 1200, 3);
  await a.run('sendText', nb, 'hola de hoy');
  await waitFor('beto recibe el de hoy', () => msgs(b, na), (l) => bodies(l).includes('hola de hoy'));
  // Se vuelve a entrar al chat: si el mensaje llego con el chat abierto, se sumo sin quitar ninguno (501)
  await b.run('open', null);
  const first = await msgs(b, na);
  assert.equal(first.length, 500, 'al entrar al chat se cargan los ultimos 500');

  // La lupa del chat busca en todo el historial, sin acentos ni mayusculas
  const found = await b.run<Msg[]>('call', 'searchMessages', na, 'EL MÁS VIEJO');
  assert.deepEqual(found.map((m) => m.body), ['el mas viejo de todos'], 'encuentra el mensaje mas viejo');
  const many = await b.run<Msg[]>('call', 'searchMessages', na, 'historial 11');
  assert.ok(many.length > 1 && many.every((m, i) => i === 0 || m.sentAt >= many[i - 1].sentAt), 'resultados del mas viejo al mas nuevo');

  // Al llegar arriba se cargan los anteriores, hasta tener todo
  await b.run('call', 'loadOlder', na);
  assert.equal((await b.run<any>('call', 'getSnapshot')).messages.length, 1000, 'segunda tanda');
  await b.run('call', 'loadOlder', na);
  await b.run('call', 'loadOlder', na);
  const all = (await b.run<any>('call', 'getSnapshot')).messages as Msg[];
  assert.equal(all.length, 1201, 'todo el historial');
  assert.equal(all[0].body, 'el mas viejo de todos', 'empieza en el mas viejo');

  // Saltar a un resultado viejo con el chat recien abierto (solo 500 cargados) lo carga
  await b.run('open', null);
  await b.run('open', na);
  assert.equal(await b.run('call', 'jumpToMessage', found[0].id), true, 'salta al resultado aunque no estuviera cargado');

  // Fotos y videos del chat (sin "ver una vez")
  await a.run('sendImage', nb);
  await a.run('sendImage', nb, true);
  await waitFor('beto recibe las fotos', () => msgs(b, na), (l) => l.filter((m) => m.kind === 'image').length === 2);
  const media = await b.run<Msg[]>('call', 'listMedia', na);
  assert.equal(media.length, 1, 'la de ver una vez no aparece');
  await Promise.all([a.close(), b.close()]);
});

test('leyendo mensajes viejos: los nuevos que llegan no sacan de la lista lo que ya estaba cargado', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('seedHistory', na, 600, 2);
  const before = await msgs(b, na);
  assert.equal(before.length, 500, 'se abren los ultimos 500');
  for (let i = 1; i <= 3; i++) await a.run('sendText', nb, `nuevo ${i}`);
  await waitFor('beto recibe los 3 nuevos', () => b.run<any>('call', 'getSnapshot').then((s) => s.messages as Msg[]), (l) => bodies(l).includes('nuevo 3'));
  const after = (await b.run<any>('call', 'getSnapshot')).messages as Msg[];
  assert.equal(after.length, 503, 'los nuevos se suman sin quitar ninguno');
  assert.equal(after[0].id, before[0].id, 'el mas viejo que se veia sigue ahi');
  await Promise.all([a.close(), b.close()]);
});

test('iniciar sesion: la contraseña equivocada se rechaza, la correcta entra y despues de 10 fallos se bloquea', async () => {
  const [a, b, , nb] = await pair();
  await b.run('logout');
  assert.equal((await b.run<any>('tryLogin', nb, 'clave-equivocada')).authError, 'Usuario o contraseña incorrectos');
  assert.equal((await b.run<any>('tryLogin', 'nadie-con-este-nombre', 'clave-segura-2')).authError, 'Usuario o contraseña incorrectos', 'mismo aviso si el usuario no existe');
  const ok = await b.run<any>('tryLogin', nb, 'clave-segura-2');
  assert.deepEqual(ok, { phase: 'ready', authError: '' }, 'la correcta entra');
  // 10 fallos seguidos bloquean la cuenta un rato, aunque despues pongan la correcta
  await b.run('logout');
  for (let i = 0; i < 9; i++) await b.run('tryLogin', nb, `mala-${i}`);
  const blocked = await b.run<any>('tryLogin', nb, 'clave-segura-2');
  assert.match(blocked.authError, /Demasiados intentos/, 'bloqueada tras 10 fallos');
  await Promise.all([a.close(), b.close()]);
});

test('recuperar contraseña: con el codigo se cambia, se cierran las sesiones abiertas y la vieja ya no sirve', async () => {
  counter++;
  const nb = `rita${counter}`;
  const b = new Device(nb, serverUrl);
  const c = new Device(`${nb}-otro`, serverUrl);
  await Promise.all([b.ready, c.ready]);
  await Promise.all([b.run('boot'), c.run('boot')]);
  const code = await b.run<string>('register', nb, 'clave-vieja-1');
  assert.match(code, /^[0-9A-F]{12}$/, 'el codigo de recuperacion se muestra al registrarse');
  // Desde otro telefono: codigo equivocado, y despues el correcto
  assert.match((await c.run<any>('resetPassword', nb, '000000000000', 'clave-nueva-1')).authError, /incorrectos/);
  assert.match((await c.run<any>('resetPassword', nb, code, 'clave-nueva-1')).authInfo, /Contraseña actualizada/);
  // La sesion que estaba abierta se cierra sola
  const closed = await waitFor('el telefono con la sesion vieja sale', () => b.run<any>('call', 'getSnapshot'), (s) => s.phase === 'loggedOut');
  assert.match(closed.authError, /sesión se cerró/);
  assert.equal((await c.run<any>('tryLogin', nb, 'clave-vieja-1')).authError, 'Usuario o contraseña incorrectos', 'la vieja ya no sirve');
  assert.equal((await c.run<any>('tryLogin', nb, 'clave-nueva-1')).phase, 'ready', 'la nueva si');
  await Promise.all([b.close(), c.close()]);
});

test('notificaciones al cambiar de cuenta en el mismo telefono: solo le llegan las de la cuenta abierta', async () => {
  const [a, b, , nb] = await pair();
  await b.run('allowPush', true);
  await b.run('dropConnection');
  await waitFor('beto reconecta', () => b.run<any>('state'), (s) => s.connected);
  await sleep(500);
  // En el mismo telefono se sale de beto SIN conexion (el servidor nunca se entera) y se crea otra cuenta
  await b.run('offline', true);
  await b.run('call', 'logout');
  await b.run('offline', false);
  await b.run('register', `${nb}-nueva`, 'clave-segura-3');
  await sleep(500);
  const before = pushes.length;
  await a.run('sendText', nb, 'esto es para beto');
  await waitFor('ana ve su mensaje enviado', () => msgs(a, nb), (l) => l.some((m) => m.body === 'esto es para beto' && m.status !== 'pending'));
  await sleep(800);
  assert.ok(!pushes.slice(before).some((p) => p.to === `ExponentPushToken[${nb}]`), 'el telefono ya no recibe avisos de la cuenta que cerro');
  await Promise.all([a.close(), b.close()]);
});

test('borrar para mi un mensaje que todavia no sale (🕓) cancela el envio: el otro nunca lo recibe', async () => {
  const [a, b, na, nb] = await pair();
  await a.run('offline', true);
  await a.run('sendText', nb, 'mejor no lo mando');
  await a.run('sendImage', nb);
  await a.run('sendText', nb, 'este si');
  const pending = (await msgs(a, nb)).filter((m) => m.status === 'pending');
  assert.equal(pending.length, 3, 'los tres esperan conexion');
  for (const m of pending.filter((m) => m.body !== 'este si')) await a.run('call', 'deleteForMe', m.id);
  await a.run('offline', false);
  await waitFor('beto recibe el que si', () => msgs(b, na), (l) => bodies(l).includes('este si'));
  await sleep(800);
  const got = await msgs(b, na);
  assert.deepEqual(bodies(got), ['este si'], 'ni el texto ni la foto borrados llegan');
  assert.equal((await a.run<any>('diagnostics')).outbox.length, 0, 'la cola de salida quedo vacia');
  await Promise.all([a.close(), b.close()]);
});

(async () => {
  const started = await startServer();
  const url = started.url;
  storage = started.storage;
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
