import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/chat/Avatar';
import { PromptModal } from '../components/chat/Modals';
import { useChatTheme } from '../components/chat/useChatTheme';
import { client, ClientState } from '../lib/client';

export function ContactsScreen({ state, onOpenSettings }: { state: ClientState; onOpenSettings: () => void }) {
  const { isDark, colors, styles } = useChatTheme();
  const [adding, setAdding] = useState(false);

  const updateProfilePicture = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.3,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    if (!client.updateProfilePicture(result.assets[0].base64)) Alert.alert('Sin conexión', 'Intenta de nuevo cuando haya conexión.');
  };

  const addContact = async (username: string) => {
    if (!username.trim()) return;
    setAdding(false);
    const res = await client.addContact(username);
    if (!res.success) Alert.alert('No se pudo agregar', res.error || 'Intenta de nuevo');
  };

  const confirmLogout = () => {
    Alert.alert('Cerrar sesión', 'Tus mensajes se quedan guardados y cifrados en este teléfono.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: () => client.logout() },
    ]);
  };

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={updateProfilePicture} activeOpacity={0.7}>
              <Avatar name={state.username} size={40} photoBase64={state.myProfilePicture} />
            </TouchableOpacity>
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={styles.headerTitle}>{state.username.toUpperCase()}</Text>
              <Text style={styles.headerSubtitle}>{state.connected ? '● ENLACE ACTIVO' : '● SIN ENLACE'}</Text>
            </View>
            <TouchableOpacity onPress={onOpenSettings} style={styles.headerIconButton} activeOpacity={0.7}>
              <Text style={styles.headerIconText}>⚙️</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmLogout} style={styles.logoutButton} activeOpacity={0.7}>
              <Text style={styles.logoutButtonText}>SALIR</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.sectionDivider, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <Text style={styles.sectionTitle}>REGISTRO DE CONTACTOS</Text>
          <TouchableOpacity onPress={() => setAdding(true)} activeOpacity={0.7}>
            <Text style={[styles.sectionTitle, { color: colors.accent }]}>+ AGREGAR</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={state.contacts}
          keyExtractor={(item) => item.username}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🦅</Text>
              <Text style={styles.emptyText}>SIN CONTACTOS REGISTRADOS</Text>
              <Text style={[styles.emptyText, { marginTop: 8, fontWeight: '400' }]}>Toca + AGREGAR y escribe el usuario de la otra persona</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.userRow} onPress={() => client.openConversation(item.username)} activeOpacity={0.7}>
              <View>
                <Avatar name={item.username} photoBase64={item.profilePicture} />
                <View style={[styles.statusDot, { backgroundColor: item.online ? colors.primary : colors.textMuted }]} />
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.userName}>{item.username.toUpperCase()}</Text>
                <Text style={styles.userStatus}>{item.online ? 'EN LÍNEA' : 'SIN CONEXIÓN'}</Text>
                {item.identityChanged && <Text style={styles.warningText}>⚠ SU LLAVE DE SEGURIDAD CAMBIÓ</Text>}
                {!item.identityChanged && item.verified && <Text style={styles.verifiedText}>✔ VERIFICADO</Text>}
              </View>
              {item.unread > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{item.unread}</Text>
                </View>
              )}
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
        />
      </SafeAreaView>
      <PromptModal
        visible={adding}
        title="AGREGAR CONTACTO"
        message="Escribe el nombre de usuario exacto de la otra persona."
        placeholder="usuario"
        confirmLabel="AGREGAR"
        styles={styles}
        colors={colors}
        onSubmit={addContact}
        onCancel={() => setAdding(false)}
      />
    </>
  );
}
