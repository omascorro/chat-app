import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, TouchableOpacity, View } from 'react-native';
import { getAppLockEnabled } from '../lib/keystore';
import { ChatStyles } from './chat/useChatTheme';

// Si la app estuvo en segundo plano mas de esto, se vuelve a pedir huella / Face ID / codigo del telefono
const RELOCK_AFTER_MS = 30_000;

async function lockAvailable(): Promise<boolean> {
  if (!(await getAppLockEnabled())) return false;
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export function AppLock({ active, styles }: { active: boolean; styles: ChatStyles }) {
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const backgroundSince = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setChecking(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Desbloquear Aeterna', cancelLabel: 'Cancelar' });
      if (result.success) setLocked(false);
    } finally {
      setChecking(false);
    }
  }, []);

  const lockIfNeeded = useCallback(async () => {
    if (await lockAvailable()) {
      setLocked(true);
      unlock();
    }
  }, [unlock]);

  useEffect(() => {
    if (!active) {
      setLocked(false);
      return;
    }
    lockIfNeeded();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        backgroundSince.current = Date.now();
      } else if (next === 'active' && backgroundSince.current !== null) {
        const away = Date.now() - backgroundSince.current;
        backgroundSince.current = null;
        if (away > RELOCK_AFTER_MS) lockIfNeeded();
      }
    });
    return () => sub.remove();
  }, [active, lockIfNeeded]);

  if (!locked) return null;
  return (
    <View style={styles.lockScreen}>
      <Text style={{ fontSize: 48 }}>🔒</Text>
      <Text style={styles.lockTitle}>AETERNA BLOQUEADA</Text>
      <TouchableOpacity style={styles.primaryButton} onPress={unlock} disabled={checking} activeOpacity={0.8}>
        <Text style={styles.primaryButtonText}>{checking ? 'VERIFICANDO…' : 'DESBLOQUEAR'}</Text>
      </TouchableOpacity>
    </View>
  );
}
