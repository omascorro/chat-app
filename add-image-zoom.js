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

// 1. importar react-native-image-viewing
src = applyReplace(
  src,
  "import 'react-native-get-random-values';\nimport { SafeAreaView } from 'react-native-safe-area-context';",
  "import 'react-native-get-random-values';\nimport ImageViewing from 'react-native-image-viewing';\nimport { SafeAreaView } from 'react-native-safe-area-context';",
  "importar react-native-image-viewing"
);

// 2. estado para la imagen en zoom
src = applyReplace(
  src,
  "  const [selfDestructMode, setSelfDestructMode] = useState<Record<string, boolean>>({});\n  const [myProfilePicture, setMyProfilePicture] = useState<string | null>(null);",
  "  const [selfDestructMode, setSelfDestructMode] = useState<Record<string, boolean>>({});\n  const [myProfilePicture, setMyProfilePicture] = useState<string | null>(null);\n  const [zoomImageUri, setZoomImageUri] = useState<string | null>(null);",
  "estado para la imagen en zoom"
);

// 3. tocar la imagen del chat para abrirla en pantalla completa
src = applyReplace(
  src,
  "                    {item.kind === 'image' ? (\n                      <Image source={{ uri: item.text }} style={styles.messageImage} resizeMode=\"cover\" />\n                    ) : item.kind === 'video' ? (",
  "                    {item.kind === 'image' ? (\n                      <TouchableOpacity onPress={() => setZoomImageUri(item.text)} activeOpacity={0.9}>\n                        <Image source={{ uri: item.text }} style={styles.messageImage} resizeMode=\"cover\" />\n                      </TouchableOpacity>\n                    ) : item.kind === 'video' ? (",
  "tocar la imagen del chat para abrirla en pantalla completa"
);

// 4. visor de imagen a pantalla completa con pinch to zoom
src = applyReplace(
  src,
  "        </KeyboardAvoidingView>\n      </SafeAreaView>\n    </>\n  );\n}\n\nconst avatarStyles = StyleSheet.create({",
  "        </KeyboardAvoidingView>\n      </SafeAreaView>\n      <ImageViewing\n        images={zoomImageUri ? [{ uri: zoomImageUri }] : []}\n        imageIndex={0}\n        visible={!!zoomImageUri}\n        onRequestClose={() => setZoomImageUri(null)}\n      />\n    </>\n  );\n}\n\nconst avatarStyles = StyleSheet.create({",
  "visor de imagen a pantalla completa con pinch to zoom"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: zoom de imagenes agregado en', path);
