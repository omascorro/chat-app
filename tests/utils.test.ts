// Pruebas de funciones puras de la app (sin servidor ni telefonos): resaltado de la lupa, separadores de dia y emojis
import assert from 'node:assert/strict';
import { dayKey, dayLabel } from '../src/lib/dates';
import { findMatches, splitByMatches } from '../src/lib/highlight';
import { MAX_REACTION_LENGTH, QUICK_REACTIONS, REACTION_GROUPS } from '../src/lib/reactions';
import { normalizeForSearch } from '../src/lib/text';
import { sessionPeerIdentity } from '../src/lib/crypto/sessions';
import { generateIdentity, generateSignedPreKey, initiateSession, publicIdentity, respondToSession } from '../src/lib/crypto/x3dh';
import { cleanBackupMessage, cleanMediaRef, isInside, isSafeId, localFileId } from '../src/lib/validate';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log('ok -', name);
}

// Texto con las coincidencias entre corchetes, para comparar facil
const marked = (text: string, query: string) => splitByMatches(text, query).map((p) => (p.match ? `[${p.text}]` : p.text)).join('');

test('normalizar: sin mayusculas, acentos ni espacios a los lados', () => {
  assert.equal(normalizeForSearch('  Reunión MAÑANA '), 'reunion manana');
  assert.equal(normalizeForSearch('Ü ç Ñ'), 'u c n');
});

test('resaltado: encuentra sin distinguir acentos ni mayusculas, todas las veces', () => {
  assert.equal(marked('La Reunión es el viernes, reunion otra vez', 'reunion'), 'La [Reunión] es el viernes, [reunion] otra vez');
  assert.equal(marked('Café ☕ con CAFÉ', 'cafe'), '[Café] ☕ con [CAFÉ]');
  assert.equal(marked('  mañana temprano', 'MANANA'), '  [mañana] temprano', 'los espacios del principio no corren la marca');
});

test('resaltado: emojis y letras compuestas no desacomodan las posiciones', () => {
  assert.equal(marked('📷 hola 😀 HOLA', ' hola '), '📷 [hola] 😀 [HOLA]', 'la busqueda se recorta como en la base');
  // "é" escrita como e + acento (dos caracteres) tambien se marca completa
  assert.equal(marked('café rico', 'café'), '[café] rico');
});

test('resaltado: sin coincidencias o busqueda vacia el texto queda igual', () => {
  assert.deepEqual(splitByMatches('sin nada', 'xyz'), [{ text: 'sin nada', match: false }]);
  assert.deepEqual(findMatches('hola', '   '), []);
  assert.deepEqual(findMatches('', 'hola'), []);
  assert.equal(marked('aaaa', 'aa'), '[aa][aa]', 'coincidencias seguidas sin encimarse');
});

test('separadores de dia: hoy, ayer, dia de la semana y fecha', () => {
  const now = new Date(2026, 9, 26, 15, 0).getTime(); // lunes 26 de octubre de 2026, 3 pm
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
  assert.equal(dayLabel(at(2026, 9, 26, 0), now), 'Hoy');
  assert.equal(dayLabel(at(2026, 9, 25, 23), now), 'Ayer');
  assert.equal(dayLabel(at(2026, 9, 22), now), 'Jueves');
  assert.equal(dayLabel(at(2026, 9, 19), now), '19 de octubre', 'hace 7 dias ya lleva fecha');
  assert.equal(dayLabel(at(2025, 11, 31), now), '31 de diciembre de 2025', 'otro año lleva el año');
});

test('separadores de dia: minutos antes y despues de medianoche', () => {
  // 1 de noviembre de 2026 es fin del horario de verano en EE. UU.; en una computadora en esa zona tambien prueba eso
  // (en Windows la zona no se puede cambiar con TZ, asi que aqui solo prueba el cambio de dia)
  const now = new Date(2026, 10, 2, 0, 30).getTime();
  assert.equal(dayLabel(new Date(2026, 10, 1, 23, 0).getTime(), now), 'Ayer');
  assert.equal(dayLabel(new Date(2026, 10, 2, 0, 1).getTime(), now), 'Hoy');
});

test('dayKey: misma clave para el mismo dia, distinta a medianoche', () => {
  assert.equal(dayKey(new Date(2026, 9, 26, 0, 0).getTime()), dayKey(new Date(2026, 9, 26, 23, 59).getTime()));
  assert.notEqual(dayKey(new Date(2026, 9, 26, 23, 59).getTime()), dayKey(new Date(2026, 9, 27, 0, 0).getTime()));
});

test('emojis para reaccionar: todos los acepta el otro telefono, sin repetidos y con mas de 150 para elegir', () => {
  const all = REACTION_GROUPS.flatMap((g) => g.emojis);
  for (const emoji of [...QUICK_REACTIONS, ...all]) {
    assert.ok(emoji.length > 0 && emoji.length <= MAX_REACTION_LENGTH, `${emoji} es demasiado largo y el otro telefono lo ignoraria`);
    assert.ok(!/[‍]|\uD83C[\uDFFB-\uDFFF]/.test(emoji), `${emoji} es un emoji compuesto (puede verse partido)`);
  }
  for (const g of REACTION_GROUPS) assert.equal(new Set(g.emojis).size, g.emojis.length, `repetidos en ${g.title}`);
  assert.ok(new Set(all).size >= 150, `solo hay ${new Set(all).size}`);
  for (const q of QUICK_REACTIONS) assert.ok(all.includes(q), `${q} tambien debe estar en las categorias`);
});

test('ids y rutas: solo ids sin carpetas, y archivos que se quedan en su carpeta', () => {
  assert.ok(isSafeId('0123456789abcdef0123456789abcdef'));
  assert.ok(isSafeId('lote-1') && isSafeId('viejo_2'));
  for (const bad of ['', '../x', 'a/b', 'a\\b', 'c:x', 'a.b', 'x'.repeat(65), 5, null]) assert.ok(!isSafeId(bad), `${String(bad)} no es un id seguro`);
  const dir = 'file:///app/doc/media/';
  assert.ok(isInside(dir, `${dir}abc.enc`));
  for (const bad of [`${dir}../x.enc`, `${dir}a/../../x`, `${dir}`, 'file:///app/doc/otra/x', `${dir}%2e%2e/x`, `${dir}a\\..\\x`, null]) {
    assert.ok(!isInside(dir, bad), `${String(bad)} sale de la carpeta`);
  }
  assert.match(localFileId('../../salir'), /^[0-9a-f]{32}$/);
  assert.equal(localFileId('x'), localFileId('x'));
});

test('adjuntos: solo bucket, llave, nonce y direccion con el formato correcto', () => {
  const key = Buffer.alloc(32, 1).toString('base64');
  const nonce = Buffer.alloc(24, 2).toString('base64');
  const path = 'ab'.repeat(16) + '.bin';
  assert.deepEqual(cleanMediaRef({ bucket: 'voices', key, nonce, path, pad: 1, size: 2048, extra: 'x' }), { bucket: 'voices', key, nonce, path, pad: 1, size: 2048 });
  // Los mensajes viejos traen solo la URL de Supabase: se usa el nombre del archivo
  assert.equal(cleanMediaRef({ bucket: 'videos', key, nonce, url: `https://x.supabase.co/storage/v1/object/public/videos/${path}` })?.path, path);
  for (const bad of [
    { bucket: 'otro', key, nonce, path },
    { bucket: 'videos', key: 'corta', nonce, path },
    { bucket: 'videos', key, nonce: key, path },
    { bucket: 'videos', key, nonce, path: '../../etc/passwd' },
    { bucket: 'videos', key, nonce, url: 'https://x/../../a' },
    null,
    'texto',
  ]) assert.equal(cleanMediaRef(bad), null, JSON.stringify(bad));
  const doc = cleanMediaRef({ bucket: 'videos', key, nonce, path, name: '../../informe.pdf', mime: 'application/pdf', bytes: 10, size: 1e12 });
  assert.equal(doc?.name, '_.._informe.pdf');
  assert.equal(doc?.size, undefined, 'un tamaño imposible se ignora');
});

test('respaldos: los mensajes legitimos pasan igual y los alterados se rechazan', () => {
  const legit = {
    id: '0123456789abcdef0123456789abcdef', peer: 'beto', fromMe: true, kind: 'text', body: 'hola', media: null, mediaFile: null,
    downloadState: 'none', duration: null, sentAt: 1_700_000_000_000, status: 'read', selfDestruct: false, ttl: null, expiresAt: null,
    replyTo: null, editedAt: 1_700_000_001_000, deleted: false, reactions: { ana: '👍' }, readByMe: true, viewOnce: false, viewed: false,
  };
  assert.deepEqual(cleanBackupMessage(legit), legit);
  assert.equal(cleanBackupMessage({ ...legit, status: 'pending' })?.status, 'failed', 'lo que no salio queda como fallido');
  for (const bad of [{ ...legit, id: '../x' }, { ...legit, peer: '' }, { ...legit, kind: 'system' }, { ...legit, sentAt: 'ayer' }, { ...legit, viewOnce: true }, { ...legit, media: { bucket: 'x' } }, 7]) {
    assert.equal(cleanBackupMessage(bad), null, JSON.stringify(bad));
  }
});

test('sesiones: la identidad del otro sale de los datos autenticados de la sesion', () => {
  const me = generateIdentity();
  const other = generateIdentity();
  const spk = generateSignedPreKey(other, 1);
  const alice = initiateSession(me, { identity: publicIdentity(other), spk: { id: spk.id, pub: spk.pub, sig: spk.sig } });
  assert.deepEqual(sessionPeerIdentity(alice, publicIdentity(me)), publicIdentity(other));
  const bob = respondToSession(other, spk, alice.pendingPreKey!);
  assert.deepEqual(sessionPeerIdentity(bob, publicIdentity(other)), publicIdentity(me));
  assert.equal(sessionPeerIdentity({ ...alice, ad: 'AAAA' }, publicIdentity(me)), null);
});

console.log(`\n${passed} pruebas pasaron`);
