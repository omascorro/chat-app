// Pruebas de la app completa: dos telefonos (procesos con el ChatClient real) hablando por el servidor real.
// Uso: npm run test:client   (necesita la carpeta chat-backend al lado de chat-app, o AETERNA_BACKEND_DIR)
import assert from 'node:assert/strict';
import { deletedObjects, Device, pushes, startServer, waitFor } from './harness/world';

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
  const restored = await a.run<number>('call', 'importBackup', uri, 'respaldo-muy-seguro');
  assert.equal(restored, 2, 'se restauran los 2 mensajes');
  const after = await msgs(a, nb);
  assert.ok(after.some((m) => m.id === text.id && m.body === 'mi contraseña secreta es 1234'), 'vuelve el texto');
  assert.equal(await a.run('decryptMedia', nb, photo.id), await a.run('testPng'), 'y la foto, identica');
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

// Descifra una vista previa con ChaCha20-Poly1305 estandar (el mismo que usa CryptoKit en la extension del iPhone)
function openPreview(keyB64: string, data: string): { f: string; b: string } {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const raw = Buffer.from(data, 'base64');
  const d = crypto.createDecipheriv('chacha20-poly1305', Buffer.from(keyB64, 'base64'), raw.subarray(0, 12), { authTagLength: 16 });
  d.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8'));
}

test('vista previa de notificaciones: cifrada con la llave del destinatario, el servidor no la puede leer', async () => {
  const [a, b, na, nb] = await pair();
  await b.run('sendText', na, 'hola ana'); // al escribir, beto le comparte su llave de vista previa
  await waitFor('ana recibe', () => msgs(a, nb), (l) => count(l, 'hola ana') === 1);
  const bKey = await b.run<string>('deviceKey');
  assert.ok(bKey, 'beto tiene llave de vista previa');
  await a.run('spySends');
  await a.run('sendText', nb, 'nos vemos a las 8');
  const sent = await waitFor('ana manda con vista previa', () => a.run<any[]>('sentMessages'), (l) => l.some((m) => m.preview));
  const withPreview = sent.find((m) => m.preview)!;
  assert.deepEqual(openPreview(bKey!, withPreview.preview), { f: na, b: 'nos vemos a las 8' });
  assert.ok(!JSON.stringify(withPreview).includes('nos vemos'), 'el texto no viaja en claro');
  await a.run('setTimer', nb, 30);
  await a.run('sendText', nb, 'esto es temporal');
  const again = await waitFor('manda el temporal', () => a.run<any[]>('sentMessages'), (l) => l.filter((m) => m.preview).length >= 2);
  const last = again.filter((m) => m.preview).pop()!;
  assert.equal(openPreview(bKey!, last.preview).b, '⏱ Mensaje temporal', 'los temporales no muestran contenido');
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
