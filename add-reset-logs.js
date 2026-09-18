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

// 1. resetEncryption: agregar logs de diagnostico y try/catch
src = applyReplace(
  src,
  "  const resetEncryption = async () => {\n    if (!selectedUser) return;\n    const storageKey = `ratchet_${username}_${selectedUser.username}`;\n    await SecureStore.deleteItemAsync(storageKey);\n    delete ratchets.current[selectedUser.username];\n    if (myKeys.current) {\n      ratchets.current[selectedUser.username] = await loadOrCreateRatchet(username, selectedUser.username, selectedUser.publicKey, myKeys.current.secretKey);\n    }\n    console.log('🔄 Cifrado reiniciado para', selectedUser.username);\n  };",
  "  const resetEncryption = async () => {\n    console.log('Boton REINICIAR presionado');\n    if (!selectedUser) {\n      console.log('REINICIAR: no hay selectedUser, cancelando');\n      return;\n    }\n    try {\n      const storageKey = `ratchet_${username}_${selectedUser.username}`;\n      console.log('Borrando ratchet guardado:', storageKey);\n      await SecureStore.deleteItemAsync(storageKey);\n      console.log('Ratchet guardado borrado');\n      delete ratchets.current[selectedUser.username];\n      if (myKeys.current) {\n        console.log('Generando ratchet nuevo...');\n        ratchets.current[selectedUser.username] = await loadOrCreateRatchet(username, selectedUser.username, selectedUser.publicKey, myKeys.current.secretKey);\n        console.log('Ratchet nuevo generado');\n      } else {\n        console.log('REINICIAR: myKeys.current es null, no se genero ratchet nuevo');\n      }\n      console.log('🔄 Cifrado reiniciado para', selectedUser.username);\n    } catch (e) {\n      console.log('Error en REINICIAR:', e);\n    }\n  };",
  "resetEncryption: agregar logs de diagnostico y try/catch"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: logs de diagnostico de REINICIAR agregados en', path);
