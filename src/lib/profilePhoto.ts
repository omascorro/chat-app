// Fotos de perfil cifradas (como la "llave de perfil" de Signal): el servidor guarda "e1:" + base64(nonce ‖ cifrado)
// y solo mis contactos, a quienes les mando la llave por el canal cifrado, la pueden ver.
import nacl from 'tweetnacl';
import { fromB64, toB64 } from './crypto/primitives';

const PREFIX = 'e1:';

export function isEncryptedPicture(value: string | null | undefined): boolean {
  return !!value && value.startsWith(PREFIX);
}

export function newProfileKey(): Uint8Array {
  return nacl.randomBytes(32);
}

export function encryptPicture(key: Uint8Array, base64Jpeg: string): string {
  const nonce = nacl.randomBytes(24);
  const box = nacl.secretbox(fromB64(base64Jpeg), nonce, key);
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce);
  out.set(box, nonce.length);
  return PREFIX + toB64(out);
}

// Devuelve la foto en base64, o null si no tengo la llave correcta (todavia no me la mandan)
export function decryptPicture(key: Uint8Array | null, value: string): string | null {
  if (!key) return null;
  try {
    const bytes = fromB64(value.slice(PREFIX.length));
    if (bytes.length <= 24) return null;
    const opened = nacl.secretbox.open(bytes.subarray(24), bytes.subarray(0, 24), key);
    return opened ? toB64(opened) : null;
  } catch {
    return null;
  }
}
