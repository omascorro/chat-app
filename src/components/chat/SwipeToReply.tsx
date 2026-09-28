import * as Haptics from 'expo-haptics';
import { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const THRESHOLD = 60; // cuanto hay que deslizar para que se active
const MAX_DRAG = 90;

function vibrate() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// Deslizar un mensaje: a la derecha para responder (como WhatsApp) y a la izquierda para borrar.
// Solo se activa con un movimiento claramente horizontal, asi que no interfiere con desplazar el chat
// ni con mantener presionado.
export function SwipeToReply({ enabled, deleteEnabled = true, onReply, onDelete, iconColor, deleteColor, children }: {
  enabled: boolean; // responder
  deleteEnabled?: boolean;
  onReply: () => void;
  onDelete?: () => void;
  iconColor: string;
  deleteColor?: string;
  children: ReactNode;
}) {
  const offset = useSharedValue(0);
  const armed = useSharedValue(0); // 1 = listo para responder, -1 = listo para borrar
  const canDelete = deleteEnabled && !!onDelete;

  const pan = Gesture.Pan()
    .enabled(enabled || canDelete)
    .activeOffsetX([canDelete ? -15 : -1000, enabled ? 15 : 1000])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      const min = canDelete ? -MAX_DRAG : 0;
      const max = enabled ? MAX_DRAG : 0;
      offset.value = Math.max(min, Math.min(max, e.translationX));
      // Una vibracion ligera justo cuando ya se puede soltar
      const now = offset.value >= THRESHOLD ? 1 : offset.value <= -THRESHOLD ? -1 : 0;
      if (now !== 0 && armed.value !== now) scheduleOnRN(vibrate);
      armed.value = now;
    })
    .onEnd(() => {
      if (offset.value >= THRESHOLD) scheduleOnRN(onReply);
      else if (offset.value <= -THRESHOLD && onDelete) scheduleOnRN(onDelete);
      armed.value = 0;
      offset.value = withSpring(0, { damping: 18, stiffness: 180 });
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const replyIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [10, THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(offset.value, [10, THRESHOLD], [0.5, 1.1], Extrapolation.CLAMP) }],
  }));
  const deleteIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [-THRESHOLD, -10], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(offset.value, [-THRESHOLD, -10], [1.1, 0.5], Extrapolation.CLAMP) }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View>
        <Animated.View style={[{ position: 'absolute', left: 6, top: 0, bottom: 0, justifyContent: 'center' }, replyIconStyle]}>
          <Text style={{ fontSize: 22, color: iconColor, fontWeight: '700' }}>↩</Text>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center' }, deleteIconStyle]}>
          <Text style={{ fontSize: 22, color: deleteColor ?? iconColor }}>🗑</Text>
        </Animated.View>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}
