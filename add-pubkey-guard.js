const fs = require('fs');
const path = 'src/app/index.tsx';

let src = fs.readFileSync(path, 'utf8');
const hadCRLF = src.indexOf('\r\n') !== -1;
if (hadCRLF) src = src.split('\r\n').join('\n');

function applyReplace(source, oldStr, newStr, label) {
  const count = source.split(oldStr).length - 1;
  if (count !== 1) {
    throw new Error("No se encontro (o se encontro mas de una vez) el ancla: " + label + " (coincidencias: " + count + ")");
  }
  return source.split(oldStr).join(newStr);
}

// 1. RatchetState: agregar peerPublicKey
src = applyReplace(
  src,
  "type RatchetState = { sendChain: Uint8Array; recvChain: Uint8Array; sendCounter: number; recvCounter: number; skippedKeys: Record<number, string> };",
  "type RatchetState = { sendChain: Uint8Array; recvChain: Uint8Array; sendCounter: number; recvCounter: number; skippedKeys: Record<number, string>; peerPublicKey: string };",
  "RatchetState: agregar peerPublicKey"
);

// 2. initRatchet: guardar la llave publica usada para derivar
src = applyReplace(
  src,
  "  return {\n    sendChain: amFirst ? chainA : chainB,\n    recvChain: amFirst ? chainB : chainA,\n    sendCounter: 0,\n    recvCounter: 0,\n    skippedKeys: {},\n  };\n}\n\nasync function persistRatchet(myUsername: string, theirUsername: string, state: RatchetState) {",
  "  return {\n    sendChain: amFirst ? chainA : chainB,\n    recvChain: amFirst ? chainB : chainA,\n    sendCounter: 0,\n    recvCounter: 0,\n    skippedKeys: {},\n    peerPublicKey: theirPublicKeyB64,\n  };\n}\n\nasync function persistRatchet(myUsername: string, theirUsername: string, state: RatchetState) {",
  "initRatchet: guardar la llave publica usada para derivar"
);

// 3. persistRatchet: guardar peerPublicKey en disco
src = applyReplace(
  src,
  "      sendCounter: state.sendCounter,\n      recvCounter: state.recvCounter,\n      skippedKeys: state.skippedKeys,\n    }));",
  "      sendCounter: state.sendCounter,\n      recvCounter: state.recvCounter,\n      skippedKeys: state.skippedKeys,\n      peerPublicKey: state.peerPublicKey,\n    }));",
  "persistRatchet: guardar peerPublicKey en disco"
);

// 4. loadOrCreateRatchet: autocorregir si la llave publica del contacto cambio
src = applyReplace(
  src,
  "  const stored = await SecureStore.getItemAsync(storageKey);\n  if (stored) {\n    const parsed = JSON.parse(stored);\n    return {\n      sendChain: util.decodeBase64(parsed.sendChain),\n      recvChain: util.decodeBase64(parsed.recvChain),\n      sendCounter: typeof parsed.sendCounter === 'number' ? parsed.sendCounter : 0,\n      recvCounter: typeof parsed.recvCounter === 'number' ? parsed.recvCounter : 0,\n      skippedKeys: parsed.skippedKeys || {},\n    };\n  }\n  const fresh = initRatchet(myUsername, theirUsername, theirPublicKeyB64, mySecretKey);",
  "  const stored = await SecureStore.getItemAsync(storageKey);\n  if (stored) {\n    const parsed = JSON.parse(stored);\n    if (!parsed.peerPublicKey || parsed.peerPublicKey === theirPublicKeyB64) {\n      return {\n        sendChain: util.decodeBase64(parsed.sendChain),\n        recvChain: util.decodeBase64(parsed.recvChain),\n        sendCounter: typeof parsed.sendCounter === 'number' ? parsed.sendCounter : 0,\n        recvCounter: typeof parsed.recvCounter === 'number' ? parsed.recvCounter : 0,\n        skippedKeys: parsed.skippedKeys || {},\n        peerPublicKey: parsed.peerPublicKey || theirPublicKeyB64,\n      };\n    }\n    console.log('🔄 La llave publica de', theirUsername, 'cambio desde la ultima vez, generando un cifrado nuevo automaticamente');\n  }\n  const fresh = initRatchet(myUsername, theirUsername, theirPublicKeyB64, mySecretKey);",
  "loadOrCreateRatchet: autocorregir si la llave publica del contacto cambio"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: autocorreccion de llave publica agregada en', path);
