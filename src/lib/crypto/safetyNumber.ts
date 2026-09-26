// Numero de seguridad de 60 digitos, al estilo Signal: si los dos ven el mismo numero,
// nadie (ni el servidor) cambio las llaves de por medio.
import nacl from 'tweetnacl';
import { concatBytes, fromB64, utf8Bytes } from './primitives';
import { PublicIdentity } from './x3dh';

const ITERATIONS = 5200;

function fingerprint(username: string, identity: PublicIdentity): string {
  const keys = concatBytes(fromB64(identity.signPub), fromB64(identity.dhPub));
  let hash = concatBytes(Uint8Array.of(0, 1), keys, utf8Bytes(username));
  for (let i = 0; i < ITERATIONS; i++) hash = nacl.hash(concatBytes(hash, keys));

  let digits = '';
  for (let chunk = 0; chunk < 6; chunk++) {
    const o = chunk * 5;
    const value = hash[o] * 2 ** 32 + hash[o + 1] * 2 ** 24 + hash[o + 2] * 2 ** 16 + hash[o + 3] * 2 ** 8 + hash[o + 4];
    digits += (value % 100000).toString().padStart(5, '0');
  }
  return digits;
}

export function safetyNumber(me: string, myIdentity: PublicIdentity, them: string, theirIdentity: PublicIdentity): string {
  const mine = fingerprint(me, myIdentity);
  const theirs = fingerprint(them, theirIdentity);
  return me < them ? mine + theirs : theirs + mine;
}

export function formatSafetyNumber(num: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < num.length; i += 5) groups.push(num.slice(i, i + 5));
  return groups;
}
