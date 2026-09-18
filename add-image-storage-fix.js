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

// 1. quitar base64:true del picker (ya no se necesita, se lee del archivo local)
src = applyReplace(
  src,
  "    const result = await ImagePicker.launchImageLibraryAsync({\n      mediaTypes: ImagePicker.MediaTypeOptions.All,\n      quality: 0.4,\n      base64: true,\n      videoMaxDuration: 30,\n    });",
  "    const result = await ImagePicker.launchImageLibraryAsync({\n      mediaTypes: ImagePicker.MediaTypeOptions.All,\n      quality: 0.4,\n      videoMaxDuration: 30,\n    });",
  "quitar base64:true del picker (ya no se necesita, se lee del archivo local)"
);

// 2. subir la imagen a Supabase Storage en vez de mandar el base64 directo (evita el error de CursorWindow en Android)
src = applyReplace(
  src,
  "    if (!asset.base64) return;\n    const base64Image = asset.base64;\n    const msgId = Date.now().toString() + Math.random().toString(36).slice(2);\n\n    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {\n      console.log('No se pudo enviar: sin conexion en este momento');\n      const failedMsg: Message = { id: msgId, text: base64Image, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'failed' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), failedMsg] }));\n      return;\n    }\n\n    const payload = JSON.stringify({ kind: 'image', content: base64Image, id: msgId });\n    const { messageKey, counter } = takeSendKey(state);\n    const nonce = nacl.randomBytes(24);\n    const ciphertext = nacl.secretbox(util.decodeUTF8(payload), nonce, messageKey);\n    persistRatchet(username, selectedUser.username, state);\n\n    ws.current.send(JSON.stringify({\n      type: 'direct-message',\n      to: selectedUser.username,\n      ciphertext: util.encodeBase64(ciphertext),\n      nonce: util.encodeBase64(nonce),\n      counter,\n    }));\n\n    const newMsg: Message = { id: msgId, text: base64Image, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'sent' };\n    setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n  };",
  "    if (!asset.uri) return;\n    const localUri = asset.uri;\n    const msgId = Date.now().toString() + Math.random().toString(36).slice(2);\n\n    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {\n      console.log('No se pudo enviar: sin conexion en este momento');\n      const failedMsg: Message = { id: msgId, text: localUri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'failed' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), failedMsg] }));\n      return;\n    }\n\n    try {\n      const { messageKey, counter } = takeSendKey(state);\n\n      const base64Image = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });\n      const imageBytes = util.decodeBase64(base64Image);\n      const imageNonce = nacl.randomBytes(24);\n      const imageCiphertext = nacl.secretbox(imageBytes, imageNonce, messageKey);\n\n      const storagePath = `${msgId}.bin`;\n      const { error: uploadError } = await supabase.storage.from('videos').upload(storagePath, imageCiphertext.buffer.slice(imageCiphertext.byteOffset, imageCiphertext.byteOffset + imageCiphertext.byteLength), {\n        contentType: 'application/octet-stream',\n      });\n      if (uploadError) {\n        console.log('Error subiendo la imagen:', uploadError.message);\n        const failedMsg: Message = { id: msgId, text: localUri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'failed' };\n        setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), failedMsg] }));\n        return;\n      }\n\n      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(storagePath);\n\n      const payload = JSON.stringify({ kind: 'image', content: urlData.publicUrl, imageNonce: util.encodeBase64(imageNonce), id: msgId });\n      const nonce = nacl.randomBytes(24);\n      const ciphertext = nacl.secretbox(util.decodeUTF8(payload), nonce, messageKey);\n      persistRatchet(username, selectedUser.username, state);\n\n      ws.current.send(JSON.stringify({\n        type: 'direct-message',\n        to: selectedUser.username,\n        ciphertext: util.encodeBase64(ciphertext),\n        nonce: util.encodeBase64(nonce),\n        counter,\n      }));\n\n      const newMsg: Message = { id: msgId, text: localUri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'sent' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n    } catch (e) {\n      console.log('Error mandando la imagen:', e);\n    }\n  };",
  "subir la imagen a Supabase Storage en vez de mandar el base64 directo (evita el error de CursorWindow en Android)"
);

// 3. agregar imageNonce al tipo de mensaje parseado
src = applyReplace(
  src,
  "        let parsed: { kind: 'text' | 'image' | 'sticker' | 'video' | 'voice'; content: string; id: string; videoNonce?: string; audioNonce?: string; duration?: number; selfDestruct?: boolean };",
  "        let parsed: { kind: 'text' | 'image' | 'sticker' | 'video' | 'voice'; content: string; id: string; videoNonce?: string; audioNonce?: string; imageNonce?: string; duration?: number; selfDestruct?: boolean };",
  "agregar imageNonce al tipo de mensaje parseado"
);

// 4. descifrar la imagen recibida (descargar de Supabase Storage y guardar local, igual que el video)
src = applyReplace(
  src,
  "        if (parsed.kind === 'voice' && parsed.audioNonce) {",
  "        if (parsed.kind === 'image' && parsed.imageNonce) {\n          try {\n            const resp = await fetch(parsed.content);\n            const arrayBuffer = await resp.arrayBuffer();\n            const cipherBytes = new Uint8Array(arrayBuffer);\n            const imageNonceBytes = util.decodeBase64(parsed.imageNonce);\n            const decryptedImage = nacl.secretbox.open(cipherBytes, imageNonceBytes, messageKey);\n            if (decryptedImage) {\n              const localPath = `${FileSystem.documentDirectory}image_${parsed.id}.jpg`;\n              await FileSystem.writeAsStringAsync(localPath, util.encodeBase64(decryptedImage), { encoding: FileSystem.EncodingType.Base64 });\n              localContent = localPath;\n            } else {\n              console.log('No se pudo descifrar la imagen recibida');\n            }\n          } catch (e) {\n            console.log('Error descargando/descifrando imagen:', e);\n          }\n        }\n        if (parsed.kind === 'voice' && parsed.audioNonce) {",
  "descifrar la imagen recibida (descargar de Supabase Storage y guardar local, igual que el video)"
);

// 5. mostrar la imagen desde el archivo local en vez de un data-uri en base64
src = applyReplace(
  src,
  "                    {item.kind === 'image' ? (\n                      <Image source={{ uri: `data:image/jpeg;base64,${item.text}` }} style={styles.messageImage} resizeMode=\"cover\" />\n                    ) : item.kind === 'video' ? (",
  "                    {item.kind === 'image' ? (\n                      <Image source={{ uri: item.text }} style={styles.messageImage} resizeMode=\"cover\" />\n                    ) : item.kind === 'video' ? (",
  "mostrar la imagen desde el archivo local en vez de un data-uri en base64"
);

// 6. no dejar que un error al guardar en AsyncStorage se quede sin manejar (evita el crash de CursorWindow)
src = applyReplace(
  src,
  "    AsyncStorage.setItem(`messages_${username}`, JSON.stringify(conversations));",
  "    AsyncStorage.setItem(`messages_${username}`, JSON.stringify(conversations)).catch((e) => {\n      console.log('Error guardando mensajes localmente:', e);\n    });",
  "no dejar que un error al guardar en AsyncStorage se quede sin manejar (evita el crash de CursorWindow)"
);

// 7. auto-reparar el historial local si quedo corrupto/demasiado grande de antes
src = applyReplace(
  src,
  "        if (!hasLoadedHistory.current) {\n          hasLoadedHistory.current = true;\n          AsyncStorage.getItem(`messages_${pendingAuth.current.username}`).then((stored) => {\n            if (stored) setConversations(JSON.parse(stored));\n          });\n        }",
  "        if (!hasLoadedHistory.current) {\n          hasLoadedHistory.current = true;\n          const historyUsername = pendingAuth.current.username;\n          AsyncStorage.getItem(`messages_${historyUsername}`).then((stored) => {\n            if (stored) setConversations(JSON.parse(stored));\n          }).catch((e) => {\n            console.log('No se pudo cargar el historial local guardado (posiblemente corrupto), se reinicia:', e);\n            AsyncStorage.removeItem(`messages_${historyUsername}`).catch(() => {});\n          });\n        }",
  "auto-reparar el historial local si quedo corrupto/demasiado grande de antes"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: imagenes ahora se suben a Supabase Storage y AsyncStorage ya no se cae en Android');
