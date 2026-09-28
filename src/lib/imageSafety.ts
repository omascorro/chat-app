import * as ImageManipulator from 'expo-image-manipulator';
import { log } from './log';
import { deleteFile } from './media';

const MAX_PHOTO_WIDTH = 1600;

// Vuelve a codificar la foto como JPEG nuevo (sin EXIF/GPS) y la reduce si es muy grande; null si no se pudo.
// Si no se sabe el ancho (fotos compartidas desde otra app), se revisa despues de recodificar.
export async function reencodeImage(uri: string, width?: number): Promise<string | null> {
  const attempts: ImageManipulator.Action[][] = [
    width && width > MAX_PHOTO_WIDTH ? [{ resize: { width: MAX_PHOTO_WIDTH } }] : [],
    [], // segundo intento: sin cambiar el tamaño
  ];
  for (const actions of attempts) {
    try {
      const result = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG });
      if (!width && result.width > MAX_PHOTO_WIDTH) {
        try {
          const smaller = await ImageManipulator.manipulateAsync(result.uri, [{ resize: { width: MAX_PHOTO_WIDTH } }], { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG });
          await deleteFile(result.uri);
          return smaller.uri;
        } catch {
          // se queda la version sin reducir (ya sin EXIF)
        }
      }
      return result.uri;
    } catch (e) {
      log('No se pudo recodificar la imagen:', e);
    }
  }
  return null;
}
