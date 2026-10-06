// Android: el servidor manda las notificaciones "solo datos" con la vista previa cifrada. Esta tarea corre en
// segundo plano (incluso con la app cerrada), la descifra con la llave de este telefono y muestra la notificacion.
// Si algo falla, muestra el aviso generico. En iPhone esto lo hace la extension nativa (targets/notification-service).
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { decryptPreview, getDeviceKey, getPreviewsEnabled } from './preview';

export const PREVIEW_TASK = 'aeterna-notification-preview';

// Canal de los mensajes: en la pantalla de bloqueo solo dice que hay una notificacion de Aeterna; quien escribio y
// el texto se ven al desbloquear (como el iPhone por defecto). Asi nadie lee una contraseña con el telefono bloqueado.
export const MESSAGES_CHANNEL = 'mensajes';

export async function ensureMessagesChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(MESSAGES_CHANNEL, {
    name: 'Mensajes',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6B7A3A',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

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
  // El canal se crea aqui tambien: esta tarea puede correr antes de que la app se abra despues de actualizarse
  try {
    await ensureMessagesChannel();
  } catch {
    // si no se pudo, Android la manda al canal por defecto
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: { channelId: MESSAGES_CHANNEL },
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
