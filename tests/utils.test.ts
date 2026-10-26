// Pruebas de funciones puras de la app (sin servidor ni telefonos): resaltado de la lupa y separadores de dia
import assert from 'node:assert/strict';
import { dayKey, dayLabel } from '../src/lib/dates';
import { findMatches, splitByMatches } from '../src/lib/highlight';
import { normalizeForSearch } from '../src/lib/text';

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

console.log(`\n${passed} pruebas pasaron`);
