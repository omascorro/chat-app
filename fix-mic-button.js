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

// 1. agregar handleMicPress (toggle en vez de mantener presionado)
src = applyReplace(
  src,
  "      console.log('Error mandando la nota de voz:', e);\n    }\n  };\n\n  if (!authenticated) {",
  "      console.log('Error mandando la nota de voz:', e);\n    }\n  };\n\n  const handleMicPress = () => {\n    if (isRecording) {\n      stopRecordingAndSend();\n    } else {\n      startRecording();\n    }\n  };\n\n  if (!authenticated) {",
  "agregar handleMicPress (toggle en vez de mantener presionado)"
);

// 2. boton de microfono: tocar para iniciar/detener en vez de mantener presionado
src = applyReplace(
  src,
  "            <TouchableOpacity\n              style={[styles.attachButton, isRecording && styles.attachButtonRecording]}\n              onPressIn={startRecording}\n              onPressOut={stopRecordingAndSend}\n              activeOpacity={0.7}\n            >\n              <Text style={styles.attachButtonIcon}>🎤</Text>\n            </TouchableOpacity>\n            {isRecording ? (\n              <View style={styles.recordingIndicator}>\n                <View style={styles.recordingDot} />\n                <Text style={styles.recordingText}>Grabando... {recordingSeconds}s · suelta para enviar</Text>\n              </View>\n            ) : (",
  "            <TouchableOpacity\n              style={[styles.attachButton, isRecording && styles.attachButtonRecording]}\n              onPress={handleMicPress}\n              activeOpacity={0.7}\n            >\n              <Text style={styles.attachButtonIcon}>{isRecording ? '⏹' : '🎤'}</Text>\n            </TouchableOpacity>\n            {isRecording ? (\n              <View style={styles.recordingIndicator}>\n                <View style={styles.recordingDot} />\n                <Text style={styles.recordingText}>Grabando... {recordingSeconds}s · toca otra vez para enviar</Text>\n              </View>\n            ) : (",
  "boton de microfono: tocar para iniciar/detener en vez de mantener presionado"
);

if (hadCRLF) src = src.split('\n').join('\r\n');
fs.writeFileSync(path, src, 'utf8');
console.log('Listo: boton de microfono cambiado a tocar para iniciar/detener en', path);
