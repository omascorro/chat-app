// Modo de audio del telefono. En iPhone, si la app nunca lo configura, iOS usa uno que respeta el interruptor de
// silencio: con el telefono en silencio las notas de voz "se reproducian" sin sonido. Como WhatsApp, se escuchan igual.
import { setAudioModeAsync } from 'expo-audio';
import { log } from './log';

let recording = false;

export async function enterRecordingMode() {
  recording = true;
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
}

// Al terminar de grabar se vuelve a solo reproducir (en modo grabacion iOS puede bajar el volumen o usar el auricular)
export async function exitRecordingMode() {
  recording = false;
  await preparePlayback();
}

export async function preparePlayback() {
  // Cambiar el modo mientras se graba detendria la grabacion
  if (recording) return;
  try {
    // shouldPlayInBackground: la nota de voz sigue sonando si sales de la app o bloqueas el telefono
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: 'doNotMix', shouldPlayInBackground: true });
  } catch (e) {
    log('No se pudo configurar el audio para reproducir:', e);
  }
}
