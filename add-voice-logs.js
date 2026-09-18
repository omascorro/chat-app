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

// 1. agregar log del uri local despues de detener grabacion
src = applyReplace(
  src,
  "    try {\n      await audioRecorder.stop();\n      const localUri = audioRecorder.uri;\n      if (!localUri) return;\n\n      const msgId = Date.now().toString() + Math.random().toString(36).slice(2);",
  "    try {\n      await audioRecorder.stop();\n      const localUri = audioRecorder.uri;\n      console.log('Grabacion detenida, uri local:', localUri);\n      if (!localUri) {\n        console.log('No se genero un archivo de audio local, cancelando envio');\n        return;\n      }\n\n      const msgId = Date.now().toString() + Math.random().toString(36).slice(2);",
  "agregar log del uri local despues de detener grabacion"
);

// 2. agregar log de envio exitoso
src = applyReplace(
  src,
  "      const newMsg: Message = { id: msgId, text: localUri, kind: 'voice', sentByMe: true, timestamp: Date.now(), status: 'sent', duration: durationSeconds };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n    } catch (e) {\n      console.log('Error mandando la nota de voz:', e);\n    }\n  };",
  "      const newMsg: Message = { id: msgId, text: localUri, kind: 'voice', sentByMe: true, timestamp: Date.now(), status: 'sent', duration: durationSeconds };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n      console.log('Nota de voz enviada correctamente');\n    } catch (e) {\n      console.log('Error mandando la nota de voz:', e);\n    }\n  };",
  "agregar log de envio exitoso"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: logs de diagnostico agregados en', path);
