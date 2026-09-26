// Actualizaciones por EAS Update: se descargan solas y se ofrece reiniciar para aplicarlas.
// Solo llegan a builds con el mismo "runtime" (fingerprint); un cambio nativo sigue necesitando un build nuevo.
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { log } from './log';

const MIN_CHECK_INTERVAL_MS = 10 * 60 * 1000;
let lastCheck = 0;
let checking = false;
let offeredUpdateId: string | null = null;

async function checkAndOffer() {
  if (!Updates.isEnabled || checking || Date.now() - lastCheck < MIN_CHECK_INTERVAL_MS) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    const id = fetched.manifest && 'id' in fetched.manifest ? String(fetched.manifest.id) : 'nueva';
    if (!fetched.isNew || offeredUpdateId === id) return;
    offeredUpdateId = id;
    Alert.alert('Actualización lista', 'Se descargó una versión nueva de la app. ¿Reiniciar ahora para usarla?', [
      { text: 'Después', style: 'cancel' },
      { text: 'Reiniciar', onPress: () => Updates.reloadAsync().catch((e) => log('No se pudo reiniciar:', e)) },
    ]);
  } catch (e) {
    // Sin conexion o sin actualizaciones publicadas: se vuelve a intentar mas tarde
    log('No se pudo buscar actualizaciones:', e);
  } finally {
    checking = false;
  }
}

export function useAutoUpdates() {
  useEffect(() => {
    checkAndOffer();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') checkAndOffer();
    });
    return () => sub.remove();
  }, []);
}
