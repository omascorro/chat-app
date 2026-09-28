// Recorte automatico de la persona u objeto principal de una foto, para crear stickers como en WhatsApp.
// Se hace dentro del telefono (iPhone: Vision, iOS 17 o mas nuevo; Android: ML Kit). La foto nunca sale del telefono.
import { removeBackground } from '@six33/react-native-bg-removal';
import { log } from './log';

export type CutoutResult = { uri: string } | { error: string };

export async function cutOutSubject(uri: string): Promise<CutoutResult> {
  try {
    // trim: recorta el espacio vacio alrededor de lo que queda
    const result = await removeBackground(uri, { trim: true });
    // Algunas plataformas devuelven una ruta sin "file://"
    return { uri: result.startsWith('/') ? `file://${result}` : result };
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    log('No se pudo recortar la imagen:', message);
    if (/REQUIRES_API_FALLBACK|iOS 17|not supported/i.test(message)) {
      return { error: 'Este teléfono no permite el recorte automático (en iPhone se necesita iOS 17 o más nuevo).' };
    }
    if (/download|module|model/i.test(message)) {
      return { error: 'El teléfono todavía está descargando el recortador. Intenta de nuevo en un minuto.' };
    }
    return { error: 'No se encontró qué recortar en esa imagen.' };
  }
}
