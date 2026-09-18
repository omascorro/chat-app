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

// 1. log tras obtener la llave de envio
src = applyReplace(
  src,
  "    try {\n      const { messageKey, counter } = takeSendKey(state);\n\n      const base64Video = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });\n      const videoBytes = util.decodeBase64(base64Video);\n      const videoNonce = nacl.randomBytes(24);\n      const videoCiphertext = nacl.secretbox(videoBytes, videoNonce, messageKey);\n\n      const storagePath = `${msgId}.bin`;\n      const { error: uploadError } = await supabase.storage.from('videos').upload(storagePath, videoCiphertext.buffer.slice(videoCiphertext.byteOffset, videoCiphertext.byteOffset + videoCiphertext.byteLength), {\n        contentType: 'application/octet-stream',\n      });\n      if (uploadError) {",
  "    try {\n      const { messageKey, counter } = takeSendKey(state);\n      console.log('Llave de cifrado obtenida, contador:', counter);\n\n      const base64Video = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });\n      console.log('Video leido y convertido a base64, tamano:', base64Video.length);\n      const videoBytes = util.decodeBase64(base64Video);\n      const videoNonce = nacl.randomBytes(24);\n      const videoCiphertext = nacl.secretbox(videoBytes, videoNonce, messageKey);\n      console.log('Video cifrado localmente, tamano:', videoCiphertext.length);\n\n      const storagePath = `${msgId}.bin`;\n      console.log('Subiendo video a Supabase Storage...');\n      const { error: uploadError } = await supabase.storage.from('videos').upload(storagePath, videoCiphertext.buffer.slice(videoCiphertext.byteOffset, videoCiphertext.byteOffset + videoCiphertext.byteLength), {\n        contentType: 'application/octet-stream',\n      });\n      console.log('Respuesta de Supabase Storage, error:', uploadError ? uploadError.message : 'ninguno');\n      if (uploadError) {",
  "log tras obtener la llave de envio"
);

// 2. log de URL publica y antes/despues de enviar por WebSocket
src = applyReplace(
  src,
  "      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(storagePath);\n\n      const payload = JSON.stringify({ kind: 'video', content: urlData.publicUrl, videoNonce: util.encodeBase64(videoNonce), id: msgId });\n      const nonce = nacl.randomBytes(24);\n      const ciphertext = nacl.secretbox(util.decodeUTF8(payload), nonce, messageKey);\n      persistRatchet(username, selectedUser.username, state);\n\n      ws.current.send(JSON.stringify({\n        type: 'direct-message',\n        to: selectedUser.username,\n        ciphertext: util.encodeBase64(ciphertext),\n        nonce: util.encodeBase64(nonce),\n        counter,\n      }));\n\n      const newMsg: Message = { id: msgId, text: localUri, kind: 'video', sentByMe: true, timestamp: Date.now(), status: 'sent' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n    } catch (e) {\n      console.log('Error mandando el video:', e);",
  "      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(storagePath);\n      console.log('URL publica del video:', urlData.publicUrl);\n\n      const payload = JSON.stringify({ kind: 'video', content: urlData.publicUrl, videoNonce: util.encodeBase64(videoNonce), id: msgId });\n      const nonce = nacl.randomBytes(24);\n      const ciphertext = nacl.secretbox(util.decodeUTF8(payload), nonce, messageKey);\n      persistRatchet(username, selectedUser.username, state);\n\n      console.log('Enviando mensaje cifrado por WebSocket, readyState:', ws.current.readyState);\n      ws.current.send(JSON.stringify({\n        type: 'direct-message',\n        to: selectedUser.username,\n        ciphertext: util.encodeBase64(ciphertext),\n        nonce: util.encodeBase64(nonce),\n        counter,\n      }));\n      console.log('Mensaje de video enviado por WebSocket sin errores');\n\n      const newMsg: Message = { id: msgId, text: localUri, kind: 'video', sentByMe: true, timestamp: Date.now(), status: 'sent' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n      console.log('Video enviado completamente con exito');\n    } catch (e) {\n      console.log('Error mandando el video:', e);",
  "log de URL publica y antes/despues de enviar por WebSocket"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: logs completos de diagnostico de video agregados en', path);
