import * as DocumentPicker from 'expo-document-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PromptModal } from '../components/chat/Modals';
import { useChatTheme } from '../components/chat/useChatTheme';
import { BACKUP_PASSWORD_MIN_LENGTH } from '../lib/backup';
import { client } from '../lib/client';
import { getAppLockEnabled, setAppLockEnabled } from '../lib/keystore';
import { deleteFile } from '../lib/media';

type PasswordPrompt = { kind: 'export'; includeMedia: boolean } | { kind: 'import'; uri: string } | null;
type Diagnostics = Awaited<ReturnType<typeof client.getDiagnostics>>;

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { isDark, colors, styles } = useChatTheme();
  const [lockEnabled, setLockEnabled] = useState(true);
  const [lockAvailable, setLockAvailable] = useState(false);
  const [prompt, setPrompt] = useState<PasswordPrompt>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  useEffect(() => {
    getAppLockEnabled().then(setLockEnabled);
    Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(([h, e]) => setLockAvailable(h && e));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => client.getDiagnostics().then((d) => !cancelled && setDiagnostics(d));
    load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const toggleLock = async (value: boolean) => {
    if (!value) {
      // Para apagar el bloqueo hay que demostrar que eres el dueño del telefono
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirma para desactivar el bloqueo' });
      if (!result.success) return;
    }
    await setAppLockEnabled(value);
    setLockEnabled(value);
  };

  const startExport = () => {
    Alert.alert('Respaldo cifrado', '¿Incluir fotos, videos y notas de voz? El archivo puede quedar muy grande.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Solo texto', onPress: () => setPrompt({ kind: 'export', includeMedia: false }) },
      { text: 'Todo', onPress: () => setPrompt({ kind: 'export', includeMedia: true }) },
    ]);
  };

  const startImport = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    setPrompt({ kind: 'import', uri: result.assets[0].uri });
  };

  const onPassword = async (password: string) => {
    const current = prompt;
    setPrompt(null);
    if (!current) return;
    if (current.kind === 'export') {
      if (password.length < BACKUP_PASSWORD_MIN_LENGTH) {
        Alert.alert('Contraseña muy corta', `Usa al menos ${BACKUP_PASSWORD_MIN_LENGTH} caracteres. Sin ella nadie podrá abrir el respaldo, ni tú.`);
        return;
      }
      setBusy('Cifrando respaldo…');
      let uri: string | null = null;
      try {
        await new Promise((r) => setTimeout(r, 50)); // deja que se pinte el aviso antes del calculo pesado
        uri = await client.exportBackup(password, current.includeMedia);
        setBusy(null);
        await Sharing.shareAsync(uri, { mimeType: 'application/octet-stream', dialogTitle: 'Guardar respaldo de Aeterna', UTI: 'public.data' });
      } catch (e) {
        Alert.alert('No se pudo crear el respaldo', String((e as Error)?.message ?? e));
      } finally {
        setBusy(null);
        if (uri) deleteFile(uri);
      }
    } else {
      setBusy('Descifrando respaldo…');
      try {
        await new Promise((r) => setTimeout(r, 50));
        const restored = await client.importBackup(current.uri, password);
        Alert.alert('Respaldo restaurado', `Se recuperaron ${restored} mensaje(s).`);
      } catch (e) {
        Alert.alert('No se pudo restaurar', String((e as Error)?.message ?? e));
      } finally {
        setBusy(null);
        deleteFile(current.uri);
      }
    }
  };

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={onClose} style={styles.backTouchable}>
            <Text style={styles.backChevron}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.chatHeaderName}>AJUSTES</Text>
        </View>
        <ScrollView contentContainerStyle={styles.screenBody}>
          <Text style={styles.infoSectionTitle}>SEGURIDAD</Text>
          <View style={styles.settingsRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.settingsLabel}>Bloqueo con huella / Face ID</Text>
              <Text style={styles.settingsHint}>
                {lockAvailable
                  ? 'Se pide al abrir la app y al volver después de 30 segundos.'
                  : 'Configura huella, Face ID o un código en tu teléfono para usarlo.'}
              </Text>
            </View>
            <Switch value={lockEnabled && lockAvailable} onValueChange={toggleLock} disabled={!lockAvailable} />
          </View>
          <Text style={[styles.settingsHint, { marginBottom: 8 }]}>
            Las capturas y grabaciones de pantalla están bloqueadas dentro de la app, y en iOS el contenido se oculta en el selector de apps.
          </Text>

          <Text style={styles.infoSectionTitle}>RESPALDO CIFRADO</Text>
          <Text style={[styles.infoText, { marginBottom: 6 }]}>
            Guarda tu historial en un archivo protegido con una contraseña, para recuperarlo si cambias de teléfono. Los mensajes que se
            autodestruyen nunca se respaldan. Si pierdes la contraseña, el respaldo no se puede abrir.
          </Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={startExport} disabled={!!busy} activeOpacity={0.8}>
            <Text style={styles.secondaryButtonText}>CREAR RESPALDO</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={startImport} disabled={!!busy} activeOpacity={0.8}>
            <Text style={styles.secondaryButtonText}>RESTAURAR RESPALDO</Text>
          </TouchableOpacity>
          {busy && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
              <ActivityIndicator color={colors.accent} />
              <Text style={[styles.infoText, { marginLeft: 10 }]}>{busy}</Text>
            </View>
          )}

          <Text style={styles.infoSectionTitle}>DIAGNÓSTICO</Text>
          {diagnostics && (
            <View style={[styles.settingsRow, { flexDirection: 'column', alignItems: 'stretch' }]}>
              <Text style={styles.settingsLabel}>
                Conexión: {diagnostics.connected ? (diagnostics.authed ? 'activa' : 'conectado, iniciando sesión…') : 'sin conexión'}
              </Text>
              <Text style={styles.settingsHint}>Pendientes de enviar: {diagnostics.outbox.length}</Text>
              {diagnostics.outbox.slice(0, 10).map((item) => (
                <Text key={item.id} style={[styles.settingsHint, { marginTop: 6 }]}>
                  • {item.what} para {item.peer} · hace {item.ageSeconds}s · intentos: {item.attempts}
                  {item.lastError ? `\n   Último error: ${item.lastError}` : ''}
                </Text>
              ))}
              {diagnostics.lastUploadError && (
                <Text style={[styles.settingsHint, { marginTop: 6 }]}>Último archivo que no se pudo subir: {diagnostics.lastUploadError}</Text>
              )}
            </View>
          )}
          <TouchableOpacity style={styles.secondaryButton} onPress={() => client.retryNow()} activeOpacity={0.8}>
            <Text style={styles.secondaryButtonText}>REINTENTAR ENVÍOS AHORA</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
      <PromptModal
        visible={!!prompt}
        title={prompt?.kind === 'import' ? 'CONTRASEÑA DEL RESPALDO' : 'NUEVA CONTRASEÑA DEL RESPALDO'}
        message={prompt?.kind === 'import' ? 'Escribe la contraseña con la que creaste el respaldo.' : `Mínimo ${BACKUP_PASSWORD_MIN_LENGTH} caracteres. Anótala en un lugar seguro.`}
        placeholder="contraseña"
        secure
        confirmLabel={prompt?.kind === 'import' ? 'RESTAURAR' : 'CREAR'}
        styles={styles}
        colors={colors}
        onSubmit={onPassword}
        onCancel={() => setPrompt(null)}
      />
    </>
  );
}
