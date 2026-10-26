import { normalizeForSearch } from './text';

// Donde aparece `query` dentro de `text`, sin distinguir mayusculas ni acentos (igual que la busqueda):
// "reunion" marca "Reunión". Devuelve [inicio, fin) en el texto original, todas las veces que aparece.
export function findMatches(text: string, query: string): [number, number][] {
  const needle = normalizeForSearch(query);
  if (!needle || !text) return [];
  // Se normaliza letra por letra para saber de que posicion del texto original viene cada letra normalizada
  let normalized = '';
  const from: [number, number][] = [];
  let i = 0;
  for (const ch of text) {
    const n = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < n.length; k++) from.push([i, i + ch.length]);
    // Un acento escrito aparte (e + ´) no deja letra: se pega a la letra anterior para que la marca lo incluya
    if (n.length === 0 && from.length > 0) from[from.length - 1][1] = i + ch.length;
    normalized += n;
    i += ch.length;
  }
  const ranges: [number, number][] = [];
  let at = normalized.indexOf(needle);
  while (at >= 0) {
    ranges.push([from[at][0], from[at + needle.length - 1][1]]);
    at = normalized.indexOf(needle, at + needle.length);
  }
  return ranges;
}

// Partes del texto: las que coinciden van con match = true
export function splitByMatches(text: string, query: string): { text: string; match: boolean }[] {
  const ranges = findMatches(text, query);
  if (ranges.length === 0) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start > pos) parts.push({ text: text.slice(pos, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    pos = end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false });
  return parts;
}

// Fondo amarillo fuerte con letra oscura (como WhatsApp): se ve igual en mis burbujas, las del otro y en todos los temas
export const HIGHLIGHT_STYLE = { backgroundColor: '#FFD54F', color: '#1A1A1A', fontWeight: '700' as const };
