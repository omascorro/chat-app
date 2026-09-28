import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/chat/Avatar';
import { useChatTheme } from '../components/chat/useChatTheme';
import { WallpaperPicker } from '../components/chat/WallpaperPicker';
import { setWallpaper, useAppearance } from '../lib/appearance';
import { client, ClientState } from '../lib/client';
import { formatSafetyNumber } from '../lib/crypto/safetyNumber';

export function ContactInfoScreen({ state, peer, onClose }: { state: ClientState; peer: string; onClose: () => void }) {
  const { isDark, colors, styles } = useChatTheme();
  const appearance = useAppearance();
  const contact = state.contacts.find((c) => c.username === peer);
  const [number, setNumber] = useState<string | null>(null);

  useEffect(() => {
    // Calcularlo toma unos cientos de ms; se hace fuera del primer render
    const timer = setTimeout(() => client.getSafetyNumber(peer).then(setNumber), 50);
    return () => clearTimeout(timer);
  }, [peer, contact?.identity?.signPub, contact?.identity?.dhPub]);

  const confirmClear = () => {
    Alert.alert(
      'Vaciar chat',
      `Se borran todos los mensajes, fotos, videos y audios de este chat. No se puede deshacer.\n\n"Para los dos" también los borra del teléfono de ${peer}.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Solo en mi teléfono', style: 'destructive', onPress: () => client.clearChat(peer, false) },
        { text: 'Para los dos', style: 'destructive', onPress: () => client.clearChat(peer, true) },
      ],
    );
  };

  const confirmReset = () => {
    Alert.alert(
      'Reiniciar sesión cifrada',
      'Se crea una sesión nueva la próxima vez que mandes un mensaje. Úsalo solo si los mensajes no se pueden descifrar.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Reiniciar', style: 'destructive', onPress: () => client.resetSession(peer) },
      ],
    );
  };

  const confirmRemove = () => {
    Alert.alert('Quitar contacto', `${peer} ya no aparecerá en tu lista. Si te vuelve a escribir, aparecerá de nuevo.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: () => {
          client.removeContact(peer);
          onClose();
          client.openConversation(null);
        },
      },
    ]);
  };

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={onClose} style={styles.backTouchable}>
            <Text style={styles.backChevron}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.chatHeaderName}>INFORMACIÓN DEL CONTACTO</Text>
        </View>
        <ScrollView contentContainerStyle={styles.screenBody}>
          <View style={{ alignItems: 'center', marginBottom: 8 }}>
            <Avatar name={peer} size={72} photoBase64={contact?.profilePicture} />
            <Text style={[styles.headerTitle, { marginTop: 10 }]}>{peer.toUpperCase()}</Text>
            {contact?.identityChanged ? (
              <Text style={styles.warningText}>⚠ SU LLAVE DE SEGURIDAD CAMBIÓ</Text>
            ) : contact?.verified ? (
              <Text style={styles.verifiedText}>✔ VERIFICADO</Text>
            ) : (
              <Text style={styles.headerSubtitle}>SIN VERIFICAR</Text>
            )}
          </View>

          <Text style={styles.infoSectionTitle}>NÚMERO DE SEGURIDAD</Text>
          <View style={styles.safetyGrid}>
            {number ? (
              formatSafetyNumber(number).map((group, i) => (
                <Text key={i} style={styles.safetyGroup}>{group}</Text>
              ))
            ) : (
              <Text style={styles.infoText}>Calculando…</Text>
            )}
          </View>
          <Text style={[styles.infoText, { marginTop: 10 }]}>
            Compara este número con el que ve {peer} en su teléfono, en persona o por una llamada. Si es idéntico, nadie (ni el servidor)
            puede leer sus mensajes. Si alguna vez cambia, la app te avisará.
          </Text>

          {contact?.identityChanged && (
            <TouchableOpacity style={styles.primaryButton} onPress={() => client.acceptIdentity(peer)} activeOpacity={0.8}>
              <Text style={styles.primaryButtonText}>ACEPTAR LLAVE NUEVA</Text>
            </TouchableOpacity>
          )}
          {!contact?.identityChanged && (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => client.setVerified(peer, !contact?.verified)} activeOpacity={0.8}>
              <Text style={styles.secondaryButtonText}>{contact?.verified ? 'QUITAR VERIFICACIÓN' : '✔ YA LO COMPARÉ: MARCAR COMO VERIFICADO'}</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.infoSectionTitle}>FONDO DE ESTE CHAT</Text>
          <WallpaperPicker
            value={appearance.perChat[peer] ?? null}
            allowInherit
            onChange={(w) => setWallpaper(peer, w)}
            styles={styles}
            colors={colors}
          />

          <Text style={styles.infoSectionTitle}>AVANZADO</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={confirmClear} activeOpacity={0.8}>
            <Text style={styles.dangerButtonText}>🗑  VACIAR CHAT</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={confirmReset} activeOpacity={0.8}>
            <Text style={styles.dangerButtonText}>REINICIAR SESIÓN CIFRADA</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={confirmRemove} activeOpacity={0.8}>
            <Text style={styles.dangerButtonText}>QUITAR DE CONTACTOS</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
