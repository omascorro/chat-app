import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChatTheme } from '../components/chat/useChatTheme';
import { client, ClientState, PASSWORD_MIN_LENGTH } from '../lib/client';

export function RecoveryCodeScreen({ code }: { code: string }) {
  const { isDark, styles } = useChatTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.authWrapper} edges={['top', 'bottom']}>
        <View style={styles.authCard}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>🔑</Text>
          </View>
          <Text style={styles.appName}>GUARDA TU CÓDIGO</Text>
          <View style={styles.appNameUnderline} />
          <Text style={styles.appTagline}>
            Si algún día olvidas tu contraseña, este es el ÚNICO código que te permitirá recuperar tu cuenta. No se puede volver a mostrar.
          </Text>
          <View style={styles.recoveryCodeBox}>
            <Text style={styles.recoveryCodeText}>{code}</Text>
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={() => client.confirmRecoveryCode()} activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>YA LO GUARDÉ, CONTINUAR</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </>
  );
}

export function AuthScreen({ state }: { state: ClientState }) {
  const { isDark, colors, styles } = useChatTheme();
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');

  const submit = () => {
    if (authMode === 'reset') {
      client.resetPassword(usernameInput, recoveryCodeInput, passwordInput);
      setPasswordInput('');
      setRecoveryCodeInput('');
    } else {
      client.authenticate(authMode, usernameInput, passwordInput);
    }
  };

  const switchMode = (mode: 'login' | 'register' | 'reset') => {
    setAuthMode(mode);
    setPasswordInput('');
  };

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.authWrapper} edges={['top', 'bottom']}>
        <View style={styles.authCard}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>🦅</Text>
          </View>
          <Text style={styles.appName}>ULTRANACHRICHT</Text>
          <View style={styles.appNameUnderline} />
          <Text style={styles.appTagline}>
            Lucharemos en las playas, lucharemos en los campos de aterrizaje, lucharemos en los campos y en las calles, lucharemos en las colinas; jamás nos rendiremos.
          </Text>

          <View style={styles.connectionPill}>
            <View style={[styles.dot, { backgroundColor: state.connected ? '#6B7A3A' : '#C0432E' }]} />
            <Text style={styles.connectionText}>{state.connected ? 'ENLACE ACTIVO' : 'CONECTANDO...'}</Text>
          </View>

          {state.updateRequired && <Text style={styles.errorText}>⚠ Hay una versión nueva de la app. Instala la actualización para seguir usándola.</Text>}

          <Text style={styles.formTitle}>
            {authMode === 'login' ? 'ACCESO AUTORIZADO' : authMode === 'register' ? 'ALTA DE OPERADOR' : 'RESTABLECER CLAVE'}
          </Text>

          <Text style={styles.inputLabel}>IDENTIFICADOR</Text>
          <TextInput
            style={styles.input}
            placeholder="usuario"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={usernameInput}
            onChangeText={setUsernameInput}
          />

          {authMode === 'reset' && (
            <>
              <Text style={styles.inputLabel}>CÓDIGO DE RECUPERACIÓN</Text>
              <TextInput
                style={styles.input}
                placeholder="código que guardaste al registrarte"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                value={recoveryCodeInput}
                onChangeText={setRecoveryCodeInput}
              />
            </>
          )}

          <Text style={styles.inputLabel}>{authMode === 'reset' ? 'NUEVA CLAVE DE ACCESO' : 'CLAVE DE ACCESO'}</Text>
          <TextInput
            style={styles.input}
            placeholder={authMode === 'login' ? 'contraseña' : `contraseña (mínimo ${PASSWORD_MIN_LENGTH} caracteres)`}
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={passwordInput}
            onChangeText={setPasswordInput}
          />

          {state.authError !== '' && !state.updateRequired && <Text style={styles.errorText}>⚠ {state.authError}</Text>}
          {state.authInfo !== '' && <Text style={[styles.errorText, { color: colors.primary }]}>✓ {state.authInfo}</Text>}

          <TouchableOpacity style={[styles.primaryButton, state.authBusy && { opacity: 0.6 }]} onPress={submit} disabled={state.authBusy} activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>
              {state.authBusy ? 'VERIFICANDO…' : authMode === 'login' ? 'INGRESAR' : authMode === 'register' ? 'REGISTRAR' : 'RESTABLECER'}
            </Text>
          </TouchableOpacity>

          {authMode === 'login' && (
            <TouchableOpacity onPress={() => switchMode('reset')}>
              <Text style={styles.switchText}>¿OLVIDASTE TU CONTRASEÑA?</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={() => switchMode(authMode === 'login' ? 'register' : 'login')}>
            <Text style={styles.switchText}>
              {authMode === 'login' ? 'SIN CREDENCIALES · ' : authMode === 'register' ? 'YA REGISTRADO · ' : 'VOLVER A · '}
              <Text style={styles.switchTextBold}>{authMode === 'login' ? 'DAR DE ALTA' : 'INICIAR SESIÓN'}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </>
  );
}
