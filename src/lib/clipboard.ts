// Copiar texto de un mensaje. Usa el portapapeles que viene dentro de React Native (ya esta en la app instalada).
import * as Haptics from 'expo-haptics';
import { Platform, ToastAndroid } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Clipboard = require('react-native/Libraries/Components/Clipboard/Clipboard').default as { setString: (text: string) => void };

export function copyText(text: string) {
  Clipboard.setString(text);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  if (Platform.OS === 'android') ToastAndroid.show('Copiado', ToastAndroid.SHORT);
}
