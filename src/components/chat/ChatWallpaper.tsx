import { ReactNode } from 'react';
import { ImageBackground, StyleProp, View, ViewStyle } from 'react-native';
import { Wallpaper } from '../../lib/appearance';

// Dibuja el fondo del chat (color o foto oscurecida) detras de los mensajes
export function ChatWallpaper({ wallpaper, fallbackColor, style, children }: {
  wallpaper: Wallpaper;
  fallbackColor: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (wallpaper.type === 'image') {
    return (
      <ImageBackground source={{ uri: wallpaper.uri }} style={[{ flex: 1, backgroundColor: fallbackColor }, style]} resizeMode="cover">
        {wallpaper.dim > 0 && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: `rgba(0,0,0,${wallpaper.dim})` }} />
        )}
        {children}
      </ImageBackground>
    );
  }
  return <View style={[{ flex: 1, backgroundColor: wallpaper.type === 'color' ? wallpaper.color : fallbackColor }, style]}>{children}</View>;
}
