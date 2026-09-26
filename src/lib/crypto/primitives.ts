import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

export const toB64 = util.encodeBase64;
export const fromB64 = util.decodeBase64;
export const utf8Bytes = util.decodeUTF8;
export const bytesToUtf8 = util.encodeUTF8;

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const HMAC_BLOCK = 128; // SHA-512

export function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  const k = key.length > HMAC_BLOCK ? nacl.hash(key) : key;
  const k0 = new Uint8Array(HMAC_BLOCK);
  k0.set(k);
  const ipad = k0.map((b) => b ^ 0x36);
  const opad = k0.map((b) => b ^ 0x5c);
  return nacl.hash(concatBytes(opad, nacl.hash(concatBytes(ipad, data))));
}

// HKDF (RFC 5869) sobre HMAC-SHA512
export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array {
  const prk = hmacSha512(salt.length > 0 ? salt : new Uint8Array(64), ikm);
  const infoBytes = utf8Bytes(info);
  const out = new Uint8Array(length);
  let t: Uint8Array = new Uint8Array(0);
  let pos = 0;
  for (let i = 1; pos < length; i++) {
    t = hmacSha512(prk, concatBytes(t, infoBytes, Uint8Array.of(i)));
    const take = Math.min(t.length, length - pos);
    out.set(t.subarray(0, take), pos);
    pos += take;
  }
  return out;
}

// PBKDF2 (RFC 8018) sobre HMAC-SHA512, para derivar la llave del respaldo a partir de una contrasena
export function pbkdf2Sha512(password: Uint8Array, salt: Uint8Array, iterations: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let pos = 0;
  for (let block = 1; pos < length; block++) {
    const blockIndex = new Uint8Array([(block >>> 24) & 0xff, (block >>> 16) & 0xff, (block >>> 8) & 0xff, block & 0xff]);
    let u = hmacSha512(password, concatBytes(salt, blockIndex));
    const t = u.slice();
    for (let i = 1; i < iterations; i++) {
      u = hmacSha512(password, u);
      for (let j = 0; j < t.length; j++) t[j] ^= u[j];
    }
    const take = Math.min(t.length, length - pos);
    out.set(t.subarray(0, take), pos);
    pos += take;
  }
  return out;
}

// X25519. Rechaza llaves publicas de orden bajo (el resultado seria todo ceros).
export function dh(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const out = nacl.scalarMult(secretKey, publicKey);
  if (out.every((b) => b === 0)) throw new Error('Llave publica invalida');
  return out;
}

export type KeyPairB64 = { pub: string; sec: string };

export function generateKeyPair(): KeyPairB64 {
  const kp = nacl.box.keyPair();
  return { pub: toB64(kp.publicKey), sec: toB64(kp.secretKey) };
}

export function randomHex(bytes: number): string {
  return Array.from(nacl.randomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newMessageId(): string {
  return randomHex(16);
}
