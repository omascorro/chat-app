import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

SplashScreen.preventAutoHideAsync();

// La app es una sola pantalla que decide que mostrar (ver index.tsx); no hay pestañas ni navegacion de rutas
export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);
  return <Slot />;
}
