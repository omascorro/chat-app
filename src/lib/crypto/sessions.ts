// Varias sesiones por contacto, como en Signal: si los dos inician a la vez quedan dos sesiones
// y se usa la ultima que funciono. La primera de la lista es la que se usa para enviar.
import { fromB64, toB64 } from './primitives';
import { Envelope, parseHeader, PreKeyInfo, ratchetDecrypt, ratchetEncrypt, RatchetState } from './ratchet';

const MAX_SESSIONS = 5;

export type SessionRecord = RatchetState[];

export function canEncrypt(record: SessionRecord): boolean {
  return record.length > 0 && !!record[0].cks;
}

export function encryptWithRecord(record: SessionRecord, plaintext: Uint8Array): { record: SessionRecord; envelope: Envelope } {
  if (!canEncrypt(record)) throw new Error('No hay sesion para enviar');
  const { state, envelope } = ratchetEncrypt(record[0], plaintext);
  return { record: [state, ...record.slice(1)], envelope };
}

function promote(record: SessionRecord, index: number, state: RatchetState): SessionRecord {
  const rest = record.filter((_, i) => i !== index);
  return [state, ...rest].slice(0, MAX_SESSIONS);
}

export type DecryptResult = { record: SessionRecord; plaintext: Uint8Array; preKey: PreKeyInfo | null };

// Identidad del otro en una sesion. Los datos asociados (ad) son firma|dh de quien inicio y firma|dh de quien
// respondio (ver x3dh.ts), y van autenticados en cada mensaje: si un mensaje descifro con esta sesion, el que lo mando
// tiene esta identidad. A diferencia del header (que llega sin autenticar), esto si sirve para decidir de quien es.
export function sessionPeerIdentity(state: RatchetState, me: { signPub: string; dhPub: string }): { signPub: string; dhPub: string } | null {
  let ad: Uint8Array;
  try {
    ad = fromB64(state.ad);
  } catch {
    return null;
  }
  if (ad.length !== 128) return null;
  const initiator = { signPub: toB64(ad.subarray(0, 32)), dhPub: toB64(ad.subarray(32, 64)) };
  const responder = { signPub: toB64(ad.subarray(64, 96)), dhPub: toB64(ad.subarray(96, 128)) };
  const isMe = (x: { signPub: string; dhPub: string }) => x.signPub === me.signPub && x.dhPub === me.dhPub;
  if (isMe(initiator) && !isMe(responder)) return responder;
  if (isMe(responder) && !isMe(initiator)) return initiator;
  return null;
}

// createFromPreKey crea la sesion de Bob a partir de los datos X3DH del header (o lanza si no se puede)
export function decryptWithRecord(
  record: SessionRecord,
  envelope: Envelope,
  createFromPreKey: (preKey: PreKeyInfo) => RatchetState,
): DecryptResult {
  const header = parseHeader(envelope.h);

  if (header.pk) {
    const index = record.findIndex((s) => s.baseKey === header.pk!.ek);
    if (index >= 0) {
      const { state, plaintext } = ratchetDecrypt(record[index], envelope);
      return { record: promote(record, index, state), plaintext, preKey: header.pk };
    }
    const fresh = createFromPreKey(header.pk);
    const { state, plaintext } = ratchetDecrypt(fresh, envelope);
    return { record: [state, ...record].slice(0, MAX_SESSIONS), plaintext, preKey: header.pk };
  }

  let lastError: unknown = new Error('No hay sesion con este contacto');
  for (let i = 0; i < record.length; i++) {
    try {
      const { state, plaintext } = ratchetDecrypt(record[i], envelope);
      return { record: promote(record, i, state), plaintext, preKey: null };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
