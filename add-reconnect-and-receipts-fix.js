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

// 1. importar AppState
src = applyReplace(
  src,
  "import {\n  FlatList,\n  Image,\n  KeyboardAvoidingView,\n  Linking,\n  Platform,\n  StyleSheet,\n  Text,\n  TextInput,\n  TouchableOpacity,\n  useColorScheme,\n  View,\n} from 'react-native';",
  "import {\n  AppState,\n  FlatList,\n  Image,\n  KeyboardAvoidingView,\n  Linking,\n  Platform,\n  StyleSheet,\n  Text,\n  TextInput,\n  TouchableOpacity,\n  useColorScheme,\n  View,\n} from 'react-native';",
  "importar AppState"
);

// 2. refs para saber que conversacion esta abierta y que mensajes ya se marcaron como leidos
src = applyReplace(
  src,
  "  useEffect(() => { onlineUsersRef.current = onlineUsers; }, [onlineUsers]);\n  useEffect(() => { usernameRef.current = username; }, [username]);",
  "  const selectedUserRef = useRef<OnlineUser | null>(null);\n  const receiptedMessageIds = useRef<Set<string>>(new Set());\n\n  useEffect(() => { onlineUsersRef.current = onlineUsers; }, [onlineUsers]);\n  useEffect(() => { usernameRef.current = username; }, [username]);\n  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);",
  "refs para saber que conversacion esta abierta y que mensajes ya se marcaron como leidos"
);

// 3. solo mandar el read-receipt si de verdad tenes esa conversacion abierta y la app en primer plano
src = applyReplace(
  src,
  "        setConversations((prev) => ({ ...prev, [sender]: [...(prev[sender] || []), newMsg] }));\n        if (parsed.selfDestruct) {\n          scheduleSelfDestruct(sender, parsed.id);\n        }\n\n        ws.current?.send(JSON.stringify({ type: 'read-receipt', to: sender, messageId: parsed.id }));\n      })();\n    }\n  };",
  "        setConversations((prev) => ({ ...prev, [sender]: [...(prev[sender] || []), newMsg] }));\n        if (parsed.selfDestruct) {\n          scheduleSelfDestruct(sender, parsed.id);\n        }\n\n        const estaViendoEsaConversacionAhora = selectedUserRef.current?.username === sender && AppState.currentState === 'active';\n        if (estaViendoEsaConversacionAhora) {\n          receiptedMessageIds.current.add(parsed.id);\n          ws.current?.send(JSON.stringify({ type: 'read-receipt', to: sender, messageId: parsed.id }));\n        }\n      })();\n    }\n  };",
  "solo mandar el read-receipt si de verdad tenes esa conversacion abierta y la app en primer plano"
);

// 4. al abrir una conversacion, recien ahi mandar los read-receipts pendientes de los mensajes que ya habian llegado
src = applyReplace(
  src,
  "  const openConversation = async (user: OnlineUser) => {\n    if (!ratchets.current[user.username] && myKeys.current) {\n      ratchets.current[user.username] = await loadOrCreateRatchet(username, user.username, user.publicKey, myKeys.current.secretKey);\n    }\n    setSelectedUser(user);\n  };",
  "  const openConversation = async (user: OnlineUser) => {\n    if (!ratchets.current[user.username] && myKeys.current) {\n      ratchets.current[user.username] = await loadOrCreateRatchet(username, user.username, user.publicKey, myKeys.current.secretKey);\n    }\n    setSelectedUser(user);\n\n    const pendientes = (conversations[user.username] || []).filter((m) => !m.sentByMe && !receiptedMessageIds.current.has(m.id));\n    pendientes.forEach((m) => {\n      receiptedMessageIds.current.add(m.id);\n      ws.current?.send(JSON.stringify({ type: 'read-receipt', to: user.username, messageId: m.id }));\n    });\n  };",
  "al abrir una conversacion, recien ahi mandar los read-receipts pendientes de los mensajes que ya habian llegado"
);

// 5. reconectar el WebSocket al volver del segundo plano si la conexion quedo muerta
src = applyReplace(
  src,
  "  useEffect(() => {\n    shouldReconnect.current = true;\n    connectWebSocket();\n    return () => {\n      shouldReconnect.current = false;\n      ws.current?.close();\n    };\n  }, []);",
  "  useEffect(() => {\n    shouldReconnect.current = true;\n    connectWebSocket();\n    return () => {\n      shouldReconnect.current = false;\n      ws.current?.close();\n    };\n  }, []);\n\n  useEffect(() => {\n    const subscription = AppState.addEventListener('change', (nextAppState) => {\n      if (nextAppState === 'active') {\n        console.log('La app volvio a primer plano, revisando la conexion...');\n        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {\n          console.log('La conexion habia quedado muerta, reconectando...');\n          ws.current?.close();\n          shouldReconnect.current = true;\n          connectWebSocket();\n        }\n      }\n    });\n    return () => subscription.remove();\n  }, []);",
  "reconectar el WebSocket al volver del segundo plano si la conexion quedo muerta"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: reconexion al volver del segundo plano + read-receipts corregidos en', path);
