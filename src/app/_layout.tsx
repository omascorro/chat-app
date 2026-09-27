import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

SplashScreen.preventAutoHideAsync();

// La app es una sola pantalla que decide que mostrar (ver index.tsx); no hay pestañas ni navegacion de rutas.
// GestureHandlerRootView hace falta para los gestos (deslizar un mensaje para responder).
export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Slot />
    </GestureHandlerRootView>
  );
}
