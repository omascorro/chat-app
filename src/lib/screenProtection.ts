// Bloqueo de capturas de pantalla. Es opcional (Ajustes); las fotos de "ver una vez" siempre se protegen mientras
// estan abiertas. Cada uso tiene su propia clave: el sistema desbloquea solo cuando ninguna clave lo pide.
import * as ScreenCapture from 'expo-screen-capture';
import * as SecureStore from 'expo-secure-store';
import { log } from './log';

const SETTING_KEY = 'screen_capture_block';
const APP_KEY = 'app';
const VIEW_ONCE_KEY = 'viewonce';

export async function getScreenCaptureBlocked(): Promise<boolean> {
  return (await SecureStore.getItemAsync(SETTING_KEY)) === 'on';
}

export async function setScreenCaptureBlocked(blocked: boolean) {
  await SecureStore.setItemAsync(SETTING_KEY, blocked ? 'on' : 'off');
  await applyAppProtection(blocked);
}

async function applyAppProtection(blocked: boolean) {
  try {
    if (blocked) await ScreenCapture.preventScreenCaptureAsync(APP_KEY);
    else await ScreenCapture.allowScreenCaptureAsync(APP_KEY);
  } catch (e) {
    log('No se pudo cambiar el bloqueo de capturas:', e);
  }
}

// Al arrancar la app
export async function initScreenProtection() {
  await applyAppProtection(await getScreenCaptureBlocked());
}

export async function protectViewOnce(active: boolean) {
  try {
    if (active) await ScreenCapture.preventScreenCaptureAsync(VIEW_ONCE_KEY);
    else await ScreenCapture.allowScreenCaptureAsync(VIEW_ONCE_KEY);
  } catch (e) {
    log('No se pudo cambiar la proteccion de la foto:', e);
  }
}

// Antes de reiniciar la app para una actualizacion: en iPhone el bloqueo mete la ventana dentro de un campo
// "seguro" y si se reinicia asi queda todo en negro. Se liberan todas las claves (tambien 'default',
// la que usaban las versiones anteriores).
export async function releaseAllScreenProtection() {
  for (const key of ['default', APP_KEY, VIEW_ONCE_KEY]) {
    try {
      await ScreenCapture.allowScreenCaptureAsync(key);
    } catch {
      // esa clave no estaba activa
    }
  }
}
