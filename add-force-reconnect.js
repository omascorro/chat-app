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

// 1. al volver del segundo plano, forzar SIEMPRE una conexion nueva (no confiar en el readyState, que miente cuando la conexion quedo zombie)
src = applyReplace(
  src,
  "  useEffect(() => {\n    const subscription = AppState.addEventListener('change', (nextAppState) => {\n      if (nextAppState === 'active') {\n        console.log('La app volvio a primer plano, revisando la conexion...');\n        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {\n          console.log('La conexion habia quedado muerta, reconectando...');\n          ws.current?.close();\n          shouldReconnect.current = true;\n          connectWebSocket();\n        }\n      }\n    });\n    return () => subscription.remove();\n  }, []);",
  "  useEffect(() => {\n    const subscription = AppState.addEventListener('change', (nextAppState) => {\n      if (nextAppState === 'active') {\n        console.log('La app volvio a primer plano, forzando conexion nueva (la anterior puede estar muerta sin avisar)...');\n        if (ws.current) {\n          ws.current.onclose = null;\n          ws.current.close();\n        }\n        shouldReconnect.current = true;\n        connectWebSocket();\n      }\n    });\n    return () => subscription.remove();\n  }, []);",
  "al volver del segundo plano, forzar SIEMPRE una conexion nueva (no confiar en el readyState, que miente cuando la conexion quedo zombie)"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: reconexion forzada al volver del segundo plano en', path);
