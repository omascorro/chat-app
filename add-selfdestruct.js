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

// 1. type Message: agregar selfDestruct
src = applyReplace(
  src,
  "type Message = { id: string; text: string; kind: 'text' | 'image' | 'sticker' | 'video' | 'voice'; sentByMe: boolean; timestamp: number; status?: 'sent' | 'read' | 'failed'; duration?: number };",
  "type Message = { id: string; text: string; kind: 'text' | 'image' | 'sticker' | 'video' | 'voice'; sentByMe: boolean; timestamp: number; status?: 'sent' | 'read' | 'failed'; duration?: number; selfDestruct?: boolean };",
  "type Message: agregar selfDestruct"
);

// 2. tipo parsed: agregar selfDestruct
src = applyReplace(
  src,
  "        let parsed: { kind: 'text' | 'image' | 'sticker' | 'video' | 'voice'; content: string; id: string; videoNonce?: string; audioNonce?: string; duration?: number };",
  "        let parsed: { kind: 'text' | 'image' | 'sticker' | 'video' | 'voice'; content: string; id: string; videoNonce?: string; audioNonce?: string; duration?: number; selfDestruct?: boolean };",
  "tipo parsed: agregar selfDestruct"
);

// 3. estado selfDestructMode
src = applyReplace(
  src,
  "  const [showStickers, setShowStickers] = useState(false);",
  "  const [showStickers, setShowStickers] = useState(false);\n  const [selfDestructMode, setSelfDestructMode] = useState<Record<string, boolean>>({});",
  "estado selfDestructMode"
);

// 4. helpers scheduleSelfDestruct / toggleSelfDestruct
src = applyReplace(
  src,
  "  const resetEncryption = async () => {\n    if (!selectedUser) return;\n    const storageKey = `ratchet_${username}_${selectedUser.username}`;",
  "  const SELF_DESTRUCT_SECONDS = 10;\n\n  const scheduleSelfDestruct = (otherUsername: string, messageId: string) => {\n    setTimeout(() => {\n      setConversations((prev) => {\n        const convo = prev[otherUsername];\n        if (!convo) return prev;\n        return { ...prev, [otherUsername]: convo.filter((m) => m.id !== messageId) };\n      });\n    }, SELF_DESTRUCT_SECONDS * 1000);\n  };\n\n  const toggleSelfDestruct = () => {\n    if (!selectedUser) return;\n    setSelfDestructMode((prev) => ({ ...prev, [selectedUser.username]: !prev[selectedUser.username] }));\n  };\n\n  const resetEncryption = async () => {\n    if (!selectedUser) return;\n    const storageKey = `ratchet_${username}_${selectedUser.username}`;",
  "helpers scheduleSelfDestruct / toggleSelfDestruct"
);

// 5. sendMessage: incluir selfDestruct en el payload y programar autodestruccion
src = applyReplace(
  src,
  "    const payload = JSON.stringify({ kind: 'text', content: textToSend, id: msgId });\n    const { messageKey, counter } = takeSendKey(state);\n    const nonce = nacl.randomBytes(24);\n    const ciphertext = nacl.secretbox(util.decodeUTF8(payload), nonce, messageKey);\n    persistRatchet(username, selectedUser.username, state);\n\n    ws.current.send(JSON.stringify({\n      type: 'direct-message',\n      to: selectedUser.username,\n      ciphertext: util.encodeBase64(ciphertext),\n      nonce: util.encodeBase64(nonce),\n      counter,\n    }));\n\n    const newMsg: Message = { id: msgId, text: textToSend, kind: 'text', sentByMe: true, timestamp: Date.now(), status: 'sent' };\n    setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n  };\n\n  const retrySend = (msg: Message) => {",
  "    const isSelfDestruct = !!selfDestructMode[selectedUser.username];\n    const payload = JSON.stringify({ kind: 'text', content: textToSend, id: msgId, selfDestruct: isSelfDestruct });\n    const { messageKey, counter } = takeSendKey(state);\n    const nonce = nacl.randomBytes(24);\n    const ciphertext = nacl.secretbox(util.decodeUTF8(payload), nonce, messageKey);\n    persistRatchet(username, selectedUser.username, state);\n\n    ws.current.send(JSON.stringify({\n      type: 'direct-message',\n      to: selectedUser.username,\n      ciphertext: util.encodeBase64(ciphertext),\n      nonce: util.encodeBase64(nonce),\n      counter,\n    }));\n\n    const newMsg: Message = { id: msgId, text: textToSend, kind: 'text', sentByMe: true, timestamp: Date.now(), status: 'sent', selfDestruct: isSelfDestruct };\n    setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n    if (isSelfDestruct) {\n      scheduleSelfDestruct(selectedUser.username, msgId);\n    }\n  };\n\n  const retrySend = (msg: Message) => {",
  "sendMessage: incluir selfDestruct en el payload y programar autodestruccion"
);

// 6. recepcion: guardar selfDestruct y programar autodestruccion
src = applyReplace(
  src,
  "        const newMsg: Message = {\n          id: parsed.id,\n          text: localContent,\n          kind: parsed.kind || 'text',\n          sentByMe: false,\n          timestamp: Date.now(),\n          duration: parsed.duration,\n        };\n        setConversations((prev) => ({ ...prev, [sender]: [...(prev[sender] || []), newMsg] }));\n\n        ws.current?.send(JSON.stringify({ type: 'read-receipt', to: sender, messageId: parsed.id }));",
  "        const newMsg: Message = {\n          id: parsed.id,\n          text: localContent,\n          kind: parsed.kind || 'text',\n          sentByMe: false,\n          timestamp: Date.now(),\n          duration: parsed.duration,\n          selfDestruct: parsed.selfDestruct,\n        };\n        setConversations((prev) => ({ ...prev, [sender]: [...(prev[sender] || []), newMsg] }));\n        if (parsed.selfDestruct) {\n          scheduleSelfDestruct(sender, parsed.id);\n        }\n\n        ws.current?.send(JSON.stringify({ type: 'read-receipt', to: sender, messageId: parsed.id }));",
  "recepcion: guardar selfDestruct y programar autodestruccion"
);

// 7. boton en el header del chat para activar/desactivar autodestruccion
src = applyReplace(
  src,
  "            <TouchableOpacity onPress={resetEncryption} style={styles.logoutButton} activeOpacity={0.7}>\n              <Text style={styles.logoutButtonText}>REINICIAR</Text>\n            </TouchableOpacity>\n          </View>",
  "            <TouchableOpacity\n              onPress={toggleSelfDestruct}\n              style={[styles.logoutButton, { marginRight: 8 }, selfDestructMode[selectedUser.username] && styles.selfDestructActive]}\n              activeOpacity={0.7}\n            >\n              <Text style={styles.logoutButtonText}>⏱ {selfDestructMode[selectedUser.username] ? 'ON' : 'OFF'}</Text>\n            </TouchableOpacity>\n            <TouchableOpacity onPress={resetEncryption} style={styles.logoutButton} activeOpacity={0.7}>\n              <Text style={styles.logoutButtonText}>REINICIAR</Text>\n            </TouchableOpacity>\n          </View>",
  "boton en el header del chat para activar/desactivar autodestruccion"
);

// 8. indicador de autodestruccion junto al timestamp
src = applyReplace(
  src,
  "                <View style={{ flexDirection: 'row', alignItems: 'center' }}>\n                  <Text style={styles.timestamp}>{formatTime(item.timestamp)}</Text>",
  "                <View style={{ flexDirection: 'row', alignItems: 'center' }}>\n                  {item.selfDestruct && <Text style={styles.timestamp}>⏱ </Text>}\n                  <Text style={styles.timestamp}>{formatTime(item.timestamp)}</Text>",
  "indicador de autodestruccion junto al timestamp"
);

// 9. estilo selfDestructActive
src = applyReplace(
  src,
  "    logoutButtonText: { fontSize: 10, fontWeight: '800', color: COLORS.danger, letterSpacing: 1 },",
  "    logoutButtonText: { fontSize: 10, fontWeight: '800', color: COLORS.danger, letterSpacing: 1 },\n    selfDestructActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },",
  "estilo selfDestructActive"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: mensajes autodestructibles agregados en', path);
