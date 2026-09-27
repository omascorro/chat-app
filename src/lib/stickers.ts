// Preparar imagenes para la coleccion de stickers: maximo 512 px (como WhatsApp) y PNG para conservar la transparencia
import * as ImageManipulator from 'expo-image-manipulator';
import nacl from 'tweetnacl';
import { fromB64 } from './crypto/primitives';
import { deleteIfAppFile } from './media';

const STICKER_SIZE = 512;

// El id sale del contenido: guardar dos veces el mismo sticker no lo duplica
export function stickerIdFor(base64: string): string {
  return Array.from(nacl.hash(fromB64(base64)).subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function prepareStickerImage(uri: string, width?: number, height?: number): Promise<{ id: string; base64: string }> {
  const resize = width && height && height > width ? { height: Math.min(height, STICKER_SIZE) } : { width: Math.min(width || STICKER_SIZE, STICKER_SIZE) };
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize }], { format: ImageManipulator.SaveFormat.PNG, base64: true });
  await deleteIfAppFile(result.uri);
  if (!result.base64) throw new Error('No se pudo leer la imagen');
  return { id: stickerIdFor(result.base64), base64: result.base64 };
}
