import * as Haptics from 'expo-haptics';
import { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const THRESHOLD = 60; // cuanto hay que deslizar para responder
const MAX_DRAG = 90;

function vibrate() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// Deslizar un mensaje hacia la derecha para responderlo, como en WhatsApp. Solo se activa con un movimiento
// claramente horizontal, asi que no interfiere con desplazar el chat ni con mantener presionado.
export function SwipeToReply({ enabled, onReply, iconColor, children }: {
  enabled: boolean;
  onReply: () => void;
  iconColor: string;
  children: ReactNode;
}) {
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-1000, 15])
    .failOffsetX([-12, 1000])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      offset.value = Math.max(0, Math.min(MAX_DRAG, e.translationX));
      // Una vibracion ligera justo cuando ya se puede soltar para responder
      if (!armed.value && offset.value >= THRESHOLD) {
        armed.value = true;
        scheduleOnRN(vibrate);
      } else if (armed.value && offset.value < THRESHOLD) {
        armed.value = false;
      }
    })
    .onEnd(() => {
      if (offset.value >= THRESHOLD) scheduleOnRN(onReply);
      armed.value = false;
      offset.value = withSpring(0, { damping: 18, stiffness: 180 });
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [10, THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(offset.value, [10, THRESHOLD], [0.5, 1.1], Extrapolation.CLAMP) }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View>
        <Animated.View style={[{ position: 'absolute', left: 6, top: 0, bottom: 0, justifyContent: 'center' }, iconStyle]}>
          <Text style={{ fontSize: 22, color: iconColor, fontWeight: '700' }}>↩</Text>
        </Animated.View>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}
