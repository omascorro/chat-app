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

// 1. importar expo-image-manipulator
src = applyReplace(
  src,
  "import * as ImagePicker from 'expo-image-picker';",
  "import * as ImagePicker from 'expo-image-picker';\nimport * as ImageManipulator from 'expo-image-manipulator';",
  "importar expo-image-manipulator"
);

// 2. reducir la foto antes de cifrarla y avisar si falla el envio
src = applyReplace(
  src,
  "    if (!asset.uri) {\n      console.log('La imagen seleccionada no tiene uri, cancelando envio');\n      return;\n    }\n    const localUri = asset.uri;\n    console.log('Imagen local seleccionada, uri:', localUri);\n    const msgId = Date.now().toString() + Math.random().toString(36).slice(2);\n\n    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {\n      console.log('No se pudo enviar: sin conexion en este momento');\n      const failedMsg: Message = { id: msgId, text: localUri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'failed' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), failedMsg] }));\n      return;\n    }\n\n    try {\n      const { messageKey, counter } = takeSendKey(state);\n      console.log('Llave de cifrado obtenida, contador:', counter);\n\n      const base64Image = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });",
  "    if (!asset.uri) {\n      console.log('La imagen seleccionada no tiene uri, cancelando envio');\n      return;\n    }\n    const msgId = Date.now().toString() + Math.random().toString(36).slice(2);\n\n    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {\n      console.log('No se pudo enviar: sin conexion en este momento');\n      const failedMsg: Message = { id: msgId, text: asset.uri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'failed' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), failedMsg] }));\n      return;\n    }\n\n    let localUri = asset.uri;\n    try {\n      console.log('Reduciendo tamano de la imagen antes de cifrarla...');\n      const manipulated = await ImageManipulator.manipulateAsync(\n        asset.uri,\n        [{ resize: { width: 1600 } }],\n        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG }\n      );\n      localUri = manipulated.uri;\n      console.log('Imagen reducida, uri:', localUri);\n    } catch (resizeError) {\n      console.log('No se pudo reducir la imagen, se usa la original:', resizeError);\n    }\n    console.log('Imagen local seleccionada, uri:', localUri);\n\n    try {\n      const { messageKey, counter } = takeSendKey(state);\n      console.log('Llave de cifrado obtenida, contador:', counter);\n\n      const base64Image = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });",
  "reducir la foto antes de cifrarla y avisar si falla el envio"
);

// 3. avisar NO ENVIADO si algo mas falla al mandar la imagen
src = applyReplace(
  src,
  "      const newMsg: Message = { id: msgId, text: localUri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'sent' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n      console.log('Imagen enviada completamente con exito');\n    } catch (e) {\n      console.log('Error mandando la imagen:', e);\n    }\n  };\n\n  const startRecording = async () => {",
  "      const newMsg: Message = { id: msgId, text: localUri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'sent' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));\n      console.log('Imagen enviada completamente con exito');\n    } catch (e) {\n      console.log('Error mandando la imagen:', e);\n      const failedMsg: Message = { id: msgId, text: localUri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'failed' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), failedMsg] }));\n    }\n  };\n\n  const startRecording = async () => {",
  "avisar NO ENVIADO si algo mas falla al mandar la imagen"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: fotos reducidas antes de cifrar + aviso de NO ENVIADO en fallos, en', path);
