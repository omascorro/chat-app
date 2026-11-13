// Actualizaciones por EAS Update: se descargan solas y se ofrece reiniciar para aplicarlas.
// Solo llegan a builds con el mismo "runtime" (fingerprint); un cambio nativo sigue necesitando un build nuevo.
import * as ScreenCapture from 'expo-screen-capture';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { log } from './log';
import { releaseAllScreenProtection } from './screenProtection';

// En iPhone, el bloqueo de capturas mete la ventana de la app dentro de un campo de texto "seguro". Si la app
// se reinicia asi, la ventana nunca vuelve a su lugar y todo queda en negro hasta cerrar la app.
// Por eso se quita la proteccion justo antes de reiniciar; la version nueva la vuelve a poner al arrancar.
async function restartWithUpdate() {
  await releaseAllScreenProtection();
  try {
    await ScreenCapture.disableAppSwitcherProtectionAsync();
  } catch (e) {
    log('No se pudo quitar el difuminado antes de reiniciar:', e);
  }
  await Updates.reloadAsync();
}

const MIN_CHECK_INTERVAL_MS = 10 * 60 * 1000;
let lastCheck = 0;
let checking = false;
let offeredUpdateId: string | null = null;

function offerRestart(id: string) {
  if (offeredUpdateId === id) return;
  offeredUpdateId = id;
  Alert.alert('Actualización lista', 'Se descargó una versión nueva de la app. ¿Reiniciar ahora para usarla?', [
    { text: 'Después', style: 'cancel' },
    { text: 'Reiniciar', onPress: () => restartWithUpdate().catch((e) => log('No se pudo reiniciar:', e)) },
  ]);
}

async function checkAndOffer() {
  if (!Updates.isEnabled || checking || Date.now() - lastCheck < MIN_CHECK_INTERVAL_MS) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    const id = fetched.manifest && 'id' in fetched.manifest ? String(fetched.manifest.id) : 'nueva';
    if (fetched.isNew) offerRestart(id);
  } catch (e) {
    // Sin conexion, o choco con la descarga que el telefono hace solo al abrir la app: antes se esperaban 10 min
    // para volver a buscar; ahora se intenta otra vez la proxima vez que se vuelva a la app
    lastCheck = 0;
    log('No se pudo buscar actualizaciones:', e);
  } finally {
    checking = false;
  }
}

export function useAutoUpdates() {
  // El telefono descarga solo la version nueva al abrir la app; antes eso no avisaba y se aplicaba hasta cerrarla
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  useEffect(() => {
    if (isUpdatePending) offerRestart(downloadedUpdate?.updateId ?? 'nueva');
  }, [isUpdatePending, downloadedUpdate?.updateId]);

  useEffect(() => {
    checkAndOffer();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') checkAndOffer();
    });
    return () => sub.remove();
  }, []);
}
