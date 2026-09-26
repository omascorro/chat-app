// Varias sesiones por contacto, como en Signal: si los dos inician a la vez quedan dos sesiones
// y se usa la ultima que funciono. La primera de la lista es la que se usa para enviar.
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
