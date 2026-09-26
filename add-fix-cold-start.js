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

// 1. solo forzar reconexion cuando de verdad se viene del segundo plano, no en el arranque
src = applyReplace(
  src,
  "  useEffect(() => {\n    const subscription = AppState.addEventListener('change', (nextAppState) => {\n      if (nextAppState === 'active') {\n        console.log('La app volvio a primer plano, forzando conexion nueva (la anterior puede estar muerta sin avisar)...');\n        if (ws.current) {\n          ws.current.onclose = null;\n          ws.current.close();\n        }\n        shouldReconnect.current = true;\n        connectWebSocket();\n      }\n    });\n    return () => subscription.remove();\n  }, []);",
  "  useEffect(() => {\n    let previousAppState = AppState.currentState;\n    const subscription = AppState.addEventListener('change', (nextAppState) => {\n      const vieneDeSegundoPlano = /inactive|background/.test(previousAppState) && nextAppState === 'active';\n      previousAppState = nextAppState;\n      if (vieneDeSegundoPlano) {\n        console.log('La app volvio a primer plano, forzando conexion nueva (la anterior puede estar muerta sin avisar)...');\n        if (ws.current) {\n          ws.current.onclose = null;\n          ws.current.close();\n        }\n        shouldReconnect.current = true;\n        connectWebSocket();\n      }\n    });\n    return () => subscription.remove();\n  }, []);",
  "solo forzar reconexion cuando de verdad se viene del segundo plano, no en el arranque"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: ya no se desconecta solo al abrir la app, en', path);
