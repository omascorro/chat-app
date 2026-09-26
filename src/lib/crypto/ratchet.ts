// Double Ratchet segun la especificacion publica de Signal:
// https://signal.org/docs/specifications/doubleratchet/
// Primitivas: X25519 (DH), HKDF/HMAC-SHA512 (KDF) y XSalsa20-Poly1305 (secretbox) de tweetnacl.
import nacl from 'tweetnacl';
import {
  bytesToUtf8,
  concatBytes,
  dh,
  equalBytes,
  fromB64,
  generateKeyPair,
  hkdf,
  hmacSha512,
  KeyPairB64,
  toB64,
  utf8Bytes,
} from './primitives';

const MAX_SKIP = 1000;
const MAX_STORED_SKIPPED = 2000;

export type PreKeyInfo = { ikSign: string; ikDh: string; ek: string; spkId: number };

export type Header = { dh: string; pn: number; n: number; pk?: PreKeyInfo };

// h: header serializado tal cual se autentica; c: ciphertext; nonce: nonce de secretbox
export type Envelope = { h: string; c: string; nonce: string };

export type RatchetState = {
  baseKey: string; // llave efimera del X3DH que creo esta sesion; la identifica en ambos lados
  ad: string; // datos asociados: identidades de ambos
  rk: string;
  dhs: KeyPairB64;
  dhr: string | null;
  cks: string | null;
  ckr: string | null;
  ns: number;
  nr: number;
  pn: number;
  skipped: Record<string, string>;
  // Mientras no recibamos nada del otro, cada mensaje lleva los datos del X3DH para que pueda crear la sesion
  pendingPreKey: PreKeyInfo | null;
};

function kdfRk(rk: string, dhOut: Uint8Array): [string, string] {
  const out = hkdf(dhOut, fromB64(rk), 'AeternaRatchet', 64);
  return [toB64(out.slice(0, 32)), toB64(out.slice(32, 64))];
}

function kdfCk(ck: string): [string, Uint8Array] {
  const ckBytes = fromB64(ck);
  const mk = hmacSha512(ckBytes, Uint8Array.of(0x01)).slice(0, 32);
  const next = hmacSha512(ckBytes, Uint8Array.of(0x02)).slice(0, 32);
  return [toB64(next), mk];
}

function clone(state: RatchetState): RatchetState {
  return JSON.parse(JSON.stringify(state));
}

function authTag(ad: string, h: string): Uint8Array {
  return nacl.hash(concatBytes(fromB64(ad), utf8Bytes(h))).slice(0, 32);
}

export function initAlice(sk: Uint8Array, bobSpkPub: string, ad: Uint8Array, preKey: PreKeyInfo): RatchetState {
  const dhs = generateKeyPair();
  const [rk, cks] = kdfRk(toB64(sk), dh(fromB64(dhs.sec), fromB64(bobSpkPub)));
  return {
    baseKey: preKey.ek,
    ad: toB64(ad),
    rk,
    dhs,
    dhr: bobSpkPub,
    cks,
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    pendingPreKey: preKey,
  };
}

export function initBob(sk: Uint8Array, spk: KeyPairB64, ad: Uint8Array, baseKey: string): RatchetState {
  return {
    baseKey,
    ad: toB64(ad),
    rk: toB64(sk),
    dhs: spk,
    dhr: null,
    cks: null,
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    pendingPreKey: null,
  };
}

export function ratchetEncrypt(state: RatchetState, plaintext: Uint8Array): { state: RatchetState; envelope: Envelope } {
  const s = clone(state);
  if (!s.cks) throw new Error('La sesion todavia no puede enviar');
  const [nextCk, mk] = kdfCk(s.cks);
  s.cks = nextCk;
  const header: Header = { dh: s.dhs.pub, pn: s.pn, n: s.ns };
  if (s.pendingPreKey) header.pk = s.pendingPreKey;
  s.ns += 1;

  const h = JSON.stringify(header);
  const nonce = nacl.randomBytes(24);
  const c = nacl.secretbox(concatBytes(authTag(s.ad, h), plaintext), nonce, mk);
  return { state: s, envelope: { h, c: toB64(c), nonce: toB64(nonce) } };
}

export function parseHeader(h: string): Header {
  const header = JSON.parse(h);
  if (typeof header.dh !== 'string' || !Number.isInteger(header.n) || !Number.isInteger(header.pn) || header.n < 0 || header.pn < 0) {
    throw new Error('Header invalido');
  }
  if (header.pk !== undefined) {
    const pk = header.pk;
    if (typeof pk.ikSign !== 'string' || typeof pk.ikDh !== 'string' || typeof pk.ek !== 'string' || !Number.isInteger(pk.spkId)) {
      throw new Error('Header invalido');
    }
  }
  return header;
}

function openWith(s: RatchetState, envelope: Envelope, mk: Uint8Array): Uint8Array {
  const inner = nacl.secretbox.open(fromB64(envelope.c), fromB64(envelope.nonce), mk);
  if (!inner || inner.length < 32) throw new Error('No se pudo descifrar');
  if (!equalBytes(inner.subarray(0, 32), authTag(s.ad, envelope.h))) throw new Error('Header alterado');
  return inner.slice(32);
}

function skipMessageKeys(s: RatchetState, until: number) {
  if (!s.ckr) return;
  if (until - s.nr > MAX_SKIP) throw new Error('Demasiados mensajes saltados');
  while (s.nr < until) {
    const [nextCk, mk] = kdfCk(s.ckr);
    s.skipped[`${s.dhr}:${s.nr}`] = toB64(mk);
    s.ckr = nextCk;
    s.nr += 1;
  }
  const keys = Object.keys(s.skipped);
  for (let i = 0; i < keys.length - MAX_STORED_SKIPPED; i++) delete s.skipped[keys[i]];
}

function dhRatchet(s: RatchetState, header: Header) {
  s.pn = s.ns;
  s.ns = 0;
  s.nr = 0;
  s.dhr = header.dh;
  [s.rk, s.ckr] = kdfRk(s.rk, dh(fromB64(s.dhs.sec), fromB64(s.dhr)));
  s.dhs = generateKeyPair();
  [s.rk, s.cks] = kdfRk(s.rk, dh(fromB64(s.dhs.sec), fromB64(s.dhr)));
}

// No modifica `state`: devuelve el estado nuevo solo si el mensaje se descifro bien
export function ratchetDecrypt(state: RatchetState, envelope: Envelope): { state: RatchetState; plaintext: Uint8Array } {
  const s = clone(state);
  const header = parseHeader(envelope.h);

  const skippedKey = `${header.dh}:${header.n}`;
  const stored = s.skipped[skippedKey];
  if (stored) {
    const plaintext = openWith(s, envelope, fromB64(stored));
    delete s.skipped[skippedKey];
    s.pendingPreKey = null;
    return { state: s, plaintext };
  }

  if (header.dh !== s.dhr) {
    skipMessageKeys(s, header.pn);
    dhRatchet(s, header);
  }
  skipMessageKeys(s, header.n);
  if (!s.ckr) throw new Error('Sin cadena de recepcion');
  const [nextCk, mk] = kdfCk(s.ckr);
  s.ckr = nextCk;
  s.nr += 1;

  const plaintext = openWith(s, envelope, mk);
  s.pendingPreKey = null;
  return { state: s, plaintext };
}

export function encodePayload(obj: unknown): Uint8Array {
  return utf8Bytes(JSON.stringify(obj));
}

export function decodePayload<T>(bytes: Uint8Array): T {
  return JSON.parse(bytesToUtf8(bytes));
}
