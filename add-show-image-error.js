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

// 1. importar Alert
src = applyReplace(
  src,
  "import {\n  AppState,\n  FlatList,\n  Image,\n  KeyboardAvoidingView,\n  Linking,\n  Platform,\n  StyleSheet,\n  Text,\n  TextInput,\n  TouchableOpacity,\n  useColorScheme,\n  View,\n} from 'react-native';",
  "import {\n  Alert,\n  AppState,\n  FlatList,\n  Image,\n  KeyboardAvoidingView,\n  Linking,\n  Platform,\n  StyleSheet,\n  Text,\n  TextInput,\n  TouchableOpacity,\n  useColorScheme,\n  View,\n} from 'react-native';",
  "importar Alert"
);

// 2. mostrar el error exacto en pantalla cuando falla el envio de una foto
src = applyReplace(
  src,
  "    } catch (e) {\n      console.log('Error mandando la imagen:', e);\n      const failedMsg: Message = { id: msgId, text: localUri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'failed' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), failedMsg] }));\n    }",
  "    } catch (e) {\n      console.log('Error mandando la imagen:', e);\n      Alert.alert('No se pudo mandar la foto', String(e && (e as any).message ? (e as any).message : e));\n      const failedMsg: Message = { id: msgId, text: localUri, kind: 'image', sentByMe: true, timestamp: Date.now(), status: 'failed' };\n      setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), failedMsg] }));\n    }",
  "mostrar el error exacto en pantalla cuando falla el envio de una foto"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: ahora se muestra el error exacto al fallar el envio de una foto, en', path);
