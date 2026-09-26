// X3DH simplificado (sin one-time prekeys): https://signal.org/docs/specifications/x3dh/
// La identidad tiene dos llaves: una Ed25519 para firmar y una X25519 para DH.
import nacl from 'tweetnacl';
import { concatBytes, dh, fromB64, generateKeyPair, hkdf, KeyPairB64, toB64, utf8Bytes } from './primitives';
import { initAlice, initBob, PreKeyInfo, RatchetState } from './ratchet';

export type Identity = { signPub: string; signSec: string; dhPub: string; dhSec: string };
export type PublicIdentity = { signPub: string; dhPub: string };
export type SignedPreKey = { id: number; pub: string; sec: string; sig: string; createdAt: number };
export type PublicSignedPreKey = { id: number; pub: string; sig: string };
export type Bundle = { identity: PublicIdentity; spk: PublicSignedPreKey };

export function generateIdentity(): Identity {
  const sign = nacl.sign.keyPair();
  const box = nacl.box.keyPair();
  return {
    signPub: toB64(sign.publicKey),
    signSec: toB64(sign.secretKey),
    dhPub: toB64(box.publicKey),
    dhSec: toB64(box.secretKey),
  };
}

export function publicIdentity(identity: Identity): PublicIdentity {
  return { signPub: identity.signPub, dhPub: identity.dhPub };
}

function spkSignedData(id: number, pub: string, identityDhPub: string): Uint8Array {
  // Tambien se firma la llave DH de identidad para atarla a la llave de firma
  return concatBytes(utf8Bytes(`AeternaSPK:${id}:`), fromB64(pub), fromB64(identityDhPub));
}

export function generateSignedPreKey(identity: Identity, id: number): SignedPreKey {
  const kp: KeyPairB64 = generateKeyPair();
  const sig = nacl.sign.detached(spkSignedData(id, kp.pub, identity.dhPub), fromB64(identity.signSec));
  return { id, pub: kp.pub, sec: kp.sec, sig: toB64(sig), createdAt: Date.now() };
}

export function verifyBundle(bundle: Bundle): boolean {
  try {
    return nacl.sign.detached.verify(
      spkSignedData(bundle.spk.id, bundle.spk.pub, bundle.identity.dhPub),
      fromB64(bundle.spk.sig),
      fromB64(bundle.identity.signPub),
    );
  } catch {
    return false;
  }
}

function associatedData(initiator: PublicIdentity, responder: PublicIdentity): Uint8Array {
  return concatBytes(fromB64(initiator.signPub), fromB64(initiator.dhPub), fromB64(responder.signPub), fromB64(responder.dhPub));
}

function deriveSharedKey(dh1: Uint8Array, dh2: Uint8Array, dh3: Uint8Array): Uint8Array {
  const f = new Uint8Array(32).fill(0xff);
  return hkdf(concatBytes(f, dh1, dh2, dh3), new Uint8Array(64), 'AeternaX3DH', 32);
}

// Quien empieza la conversacion (Alice)
export function initiateSession(me: Identity, bundle: Bundle): RatchetState {
  if (!verifyBundle(bundle)) throw new Error('La firma de la prekey no es valida');
  const ek = generateKeyPair();
  const dh1 = dh(fromB64(me.dhSec), fromB64(bundle.spk.pub));
  const dh2 = dh(fromB64(ek.sec), fromB64(bundle.identity.dhPub));
  const dh3 = dh(fromB64(ek.sec), fromB64(bundle.spk.pub));
  const sk = deriveSharedKey(dh1, dh2, dh3);
  const preKey: PreKeyInfo = { ikSign: me.signPub, ikDh: me.dhPub, ek: ek.pub, spkId: bundle.spk.id };
  return initAlice(sk, bundle.spk.pub, associatedData(publicIdentity(me), bundle.identity), preKey);
}

// Quien recibe el primer mensaje (Bob)
export function respondToSession(me: Identity, spk: SignedPreKey, preKey: PreKeyInfo): RatchetState {
  const dh1 = dh(fromB64(spk.sec), fromB64(preKey.ikDh));
  const dh2 = dh(fromB64(me.dhSec), fromB64(preKey.ek));
  const dh3 = dh(fromB64(spk.sec), fromB64(preKey.ek));
  const sk = deriveSharedKey(dh1, dh2, dh3);
  const initiator: PublicIdentity = { signPub: preKey.ikSign, dhPub: preKey.ikDh };
  return initBob(sk, { pub: spk.pub, sec: spk.sec }, associatedData(initiator, publicIdentity(me)), preKey.ek);
}
