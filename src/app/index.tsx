// Tiene que ser el primer import: tweetnacl elige su fuente de aleatoriedad en cuanto se carga
import 'react-native-get-random-values';
import * as Notifications from 'expo-notifications';
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { AppLock } from '../components/AppLock';
import { useChatTheme } from '../components/chat/useChatTheme';
import { client } from '../lib/client';
import { log } from '../lib/log';
import { useAutoUpdates } from '../lib/updates';
import { AuthScreen, RecoveryCodeScreen } from '../screens/AuthScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const { colors, styles } = useChatTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Nada de capturas ni grabaciones de pantalla dentro de la app
  ScreenCapture.usePreventScreenCapture();
  useAutoUpdates();

  useEffect(() => {
    client.boot().catch((e) => log('Error al arrancar:', e));
    if (Platform.OS === 'ios') {
      // En el selector de apps de iOS se ve borroso en vez del contenido del chat
      ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => {});
    }
  }, []);

  let screen;
  if (state.phase === 'booting') {
    screen = (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  } else if (state.phase === 'loggedOut') {
    screen = <AuthScreen state={state} />;
  } else if (state.phase === 'recovery' && state.recoveryCode) {
    screen = <RecoveryCodeScreen code={state.recoveryCode} />;
  } else if (state.openPeer) {
    screen = <ChatScreen key={state.openPeer} state={state} peer={state.openPeer} />;
  } else if (settingsOpen) {
    screen = <SettingsScreen onClose={() => setSettingsOpen(false)} />;
  } else {
    screen = <ContactsScreen state={state} onOpenSettings={() => setSettingsOpen(true)} />;
  }

  return (
    <View style={{ flex: 1 }}>
      {screen}
      <AppLock active={state.phase === 'ready'} styles={styles} />
    </View>
  );
}
