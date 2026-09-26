import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { hmacSha512, hkdf, pbkdf2Sha512, bytesToUtf8, utf8Bytes } from '../src/lib/crypto/primitives';
import { generateIdentity, generateSignedPreKey, initiateSession, respondToSession, publicIdentity, Bundle, verifyBundle } from '../src/lib/crypto/x3dh';
import { decryptWithRecord, encryptWithRecord, SessionRecord } from '../src/lib/crypto/sessions';
import { Envelope } from '../src/lib/crypto/ratchet';
import { safetyNumber } from '../src/lib/crypto/safetyNumber';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log('ok -', name);
}

test('HMAC-SHA512 coincide con node', () => {
  for (const klen of [0, 16, 128, 200]) {
    const key = nacl.randomBytes(klen);
    const data = nacl.randomBytes(77);
    const ours = Buffer.from(hmacSha512(key, data)).toString('hex');
    const node = crypto.createHmac('sha512', key).update(data).digest('hex');
    assert.equal(ours, node);
  }
});

test('HKDF-SHA512 coincide con node', () => {
  const ikm = nacl.randomBytes(40), salt = nacl.randomBytes(64);
  for (const len of [32, 64, 100]) {
    const ours = Buffer.from(hkdf(ikm, salt, 'info', len)).toString('hex');
    const node = Buffer.from(crypto.hkdfSync('sha512', ikm, salt, Buffer.from('info'), len)).toString('hex');
    assert.equal(ours, node);
  }
});

test('PBKDF2-SHA512 coincide con node', () => {
  const pw = utf8Bytes('contraseña'), salt = nacl.randomBytes(16);
  const ours = Buffer.from(pbkdf2Sha512(pw, salt, 1000, 80)).toString('hex');
  const node = crypto.pbkdf2Sync(Buffer.from(pw), salt, 1000, 80, 'sha512').toString('hex');
  assert.equal(ours, node);
});

type Party = { name: string; id: ReturnType<typeof generateIdentity>; spks: ReturnType<typeof generateSignedPreKey>[]; record: SessionRecord };
function party(name: string): Party {
  const id = generateIdentity();
  return { name, id, spks: [generateSignedPreKey(id, 1)], record: [] };
}
function bundleOf(p: Party): Bundle {
  const spk = p.spks[p.spks.length - 1];
  return { identity: publicIdentity(p.id), spk: { id: spk.id, pub: spk.pub, sig: spk.sig } };
}
function send(from: Party, to: Party, text: string): Envelope {
  if (from.record.length === 0 || !from.record[0].cks) from.record = [initiateSession(from.id, bundleOf(to)), ...from.record];
  const { record, envelope } = encryptWithRecord(from.record, utf8Bytes(text));
  from.record = record;
  return envelope;
}
function recv(to: Party, env: Envelope): string {
  const res = decryptWithRecord(to.record, env, (pk) => {
    const spk = to.spks.find((s) => s.id === pk.spkId);
    if (!spk) throw new Error('spk desconocida');
    return respondToSession(to.id, spk, pk);
  });
  to.record = res.record;
  return bytesToUtf8(res.plaintext);
}

test('conversacion basica con varios turnos', () => {
  const a = party('ana'), b = party('beto');
  assert.equal(recv(b, send(a, b, 'hola')), 'hola');
  assert.equal(recv(b, send(a, b, 'otra')), 'otra');
  assert.equal(recv(a, send(b, a, 'respuesta')), 'respuesta');
  for (let i = 0; i < 20; i++) {
    assert.equal(recv(b, send(a, b, 'a' + i)), 'a' + i);
    assert.equal(recv(a, send(b, a, 'b' + i)), 'b' + i);
  }
  assert.equal(a.record.length, 1);
  assert.equal(b.record.length, 1);
  assert.equal(a.record[0].pendingPreKey, null);
});

test('mensajes desordenados y saltados entre cambios de DH', () => {
  const a = party('ana'), b = party('beto');
  const first = [send(a, b, '0'), send(a, b, '1'), send(a, b, '2')];
  assert.equal(recv(b, first[2]), '2');
  assert.equal(recv(b, first[0]), '0');
  const reply = send(b, a, 'r');
  assert.equal(recv(a, reply), 'r');
  const second = [send(a, b, '3'), send(a, b, '4')];
  assert.equal(recv(b, second[1]), '4');
  assert.equal(recv(b, first[1]), '1'); // de la cadena anterior
  assert.equal(recv(b, second[0]), '3');
});

test('simulacion aleatoria: desorden, perdidas y duplicados', () => {
  for (let round = 0; round < 30; round++) {
    const a = party('ana'), b = party('beto');
    // primer mensaje entregado para establecer sesion
    assert.equal(recv(b, send(a, b, 'init')), 'init');
    const queues: Record<string, { env: Envelope; text: string }[]> = { ana: [], beto: [] };
    let delivered = 0;
    for (let step = 0; step < 200; step++) {
      const r = Math.random();
      if (r < 0.3) queues.beto.push({ env: send(a, b, 'a' + step), text: 'a' + step });
      else if (r < 0.6) queues.ana.push({ env: send(b, a, 'b' + step), text: 'b' + step });
      else {
        const who = Math.random() < 0.5 ? 'ana' : 'beto';
        const q = queues[who];
        if (q.length === 0) continue;
        const idx = Math.floor(Math.random() * q.length);
        const [item] = q.splice(idx, 1);
        if (Math.random() < 0.05) continue; // se pierde
        const target = who === 'ana' ? a : b;
        assert.equal(recv(target, item.env), item.text);
        delivered++;
        if (Math.random() < 0.05) {
          const before = JSON.stringify(target.record);
          assert.throws(() => recv(target, item.env)); // duplicado se rechaza
          assert.equal(JSON.stringify(target.record), before); // y no altera el estado
        }
      }
    }
    assert.ok(delivered > 20);
  }
});

test('varios mensajes con el mismo X3DH crean una sola sesion', () => {
  const a = party('ana'), b = party('beto');
  const envs = [send(a, b, '1'), send(a, b, '2'), send(a, b, '3')];
  recv(b, envs[1]); recv(b, envs[0]); recv(b, envs[2]);
  assert.equal(b.record.length, 1);
});

test('inicio simultaneo converge', () => {
  const a = party('ana'), b = party('beto');
  const ea = send(a, b, 'de ana');
  const eb = send(b, a, 'de beto');
  assert.equal(recv(b, ea), 'de ana');
  assert.equal(recv(a, eb), 'de beto');
  for (let i = 0; i < 5; i++) {
    assert.equal(recv(b, send(a, b, 'x' + i)), 'x' + i);
    assert.equal(recv(a, send(b, a, 'y' + i)), 'y' + i);
  }
});

test('mensaje alterado se rechaza', () => {
  const a = party('ana'), b = party('beto');
  recv(b, send(a, b, 'hola'));
  const env = send(a, b, 'secreto');
  const bad1 = { ...env, h: env.h.replace('"n":1', '"n":1 ') };
  assert.throws(() => recv(b, bad1));
  const c = Buffer.from(env.c, 'base64'); c[5] ^= 1;
  assert.throws(() => recv(b, { ...env, c: c.toString('base64') }));
  assert.equal(recv(b, env), 'secreto');
});

test('bundle con firma falsa se rechaza', () => {
  const b = party('beto'), mallory = generateIdentity();
  const bundle = bundleOf(b);
  assert.ok(verifyBundle(bundle));
  const fake: Bundle = { identity: { ...bundle.identity, dhPub: publicIdentity(mallory).dhPub }, spk: bundle.spk };
  assert.equal(verifyBundle(fake), false);
  assert.throws(() => initiateSession(generateIdentity(), fake));
});

test('un tercero no puede descifrar', () => {
  const a = party('ana'), b = party('beto'), eve = party('beto');
  const env = send(a, b, 'hola');
  assert.throws(() => recv(eve, env));
});

test('numero de seguridad simetrico y sensible a las llaves', () => {
  const a = generateIdentity(), b = generateIdentity();
  const n1 = safetyNumber('ana', publicIdentity(a), 'beto', publicIdentity(b));
  const n2 = safetyNumber('beto', publicIdentity(b), 'ana', publicIdentity(a));
  assert.equal(n1, n2);
  assert.equal(n1.length, 60);
  const n3 = safetyNumber('ana', publicIdentity(a), 'beto', publicIdentity(generateIdentity()));
  assert.notEqual(n1, n3);
});

console.log(`\n${passed} pruebas pasaron`);
