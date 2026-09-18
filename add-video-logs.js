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

// 1. sendVideo: log al entrar a la funcion
src = applyReplace(
  src,
  "  const sendVideo = async () => {\n    if (!selectedUser) return;",
  "  const sendVideo = async () => {\n    console.log('Boton de video presionado');\n    if (!selectedUser) return;",
  "sendVideo: log al entrar a la funcion"
);

// 2. sendVideo: log del resultado del selector de galeria
src = applyReplace(
  src,
  "    const result = await ImagePicker.launchImageLibraryAsync({\n      mediaTypes: ImagePicker.MediaTypeOptions.Videos,\n      videoMaxDuration: 30,\n    });\n\n    if (result.canceled || !result.assets || !result.assets[0].uri) return;\n\n    const localUri = result.assets[0].uri;",
  "    const result = await ImagePicker.launchImageLibraryAsync({\n      mediaTypes: ImagePicker.MediaTypeOptions.Videos,\n      videoMaxDuration: 30,\n    });\n\n    console.log('Resultado del selector de video: canceled=', result.canceled, 'assets=', result.assets ? result.assets.length : 0);\n    if (result.canceled || !result.assets || !result.assets[0].uri) {\n      console.log('No se selecciono ningun video valido, cancelando envio');\n      return;\n    }\n\n    const localUri = result.assets[0].uri;\n    console.log('Video local seleccionado, uri:', localUri);",
  "sendVideo: log del resultado del selector de galeria"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: logs de diagnostico de video agregados en', path);
