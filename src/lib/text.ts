// Texto para buscar: sin distinguir mayusculas ni acentos ("Reunión" -> "reunion"). Archivo aparte, sin la base de
// datos, para que el resaltado de la lupa se pueda probar fuera del telefono.
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
