// Android: el servidor manda las notificaciones "solo datos" con la vista previa cifrada. Esta tarea corre en
// segundo plano (incluso con la app cerrada), la descifra con la llave de este telefono y muestra la notificacion.
// Si algo falla, muestra el aviso generico. En iPhone esto lo hace la extension nativa (targets/notification-service).
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { decryptPreview, getDeviceKey, getPreviewsEnabled } from './preview';

export const PREVIEW_TASK = 'aeterna-notification-preview';

// El formato en que llegan los datos cambia segun la version y el estado de la app; se busca "p" donde este
function findPreviewField(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null;
  if (typeof value === 'string') {
    if (value.startsWith('{')) {
      try {
        return findPreviewField(JSON.parse(value), depth + 1);
      } catch {
        return null;
      }
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.p === 'string') return obj.p;
  for (const child of Object.values(obj)) {
    const found = findPreviewField(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

TaskManager.defineTask(PREVIEW_TASK, async ({ data, error }) => {
  if (error || Platform.OS !== 'android') return;
  const encrypted = findPreviewField(data);
  if (encrypted === null) return; // no es una de nuestras notificaciones de datos
  let title = 'Aeterna';
  let body = 'Tienes un mensaje nuevo';
  try {
    if (encrypted && (await getPreviewsEnabled())) {
      const key = await getDeviceKey();
      const preview = key ? decryptPreview(key, encrypted) : null;
      if (preview) {
        title = preview.f;
        body = preview.b;
      }
    }
  } catch {
    // se queda el aviso generico
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: { channelId: 'default' },
  });
});

export async function registerBackgroundNotifications() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.registerTaskAsync(PREVIEW_TASK);
  } catch {
    // sin la tarea, el servidor igual manda los datos; se reintentara la proxima vez
  }
}
