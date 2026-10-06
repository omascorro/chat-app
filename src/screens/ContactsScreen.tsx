import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/chat/Avatar';
import { ChatPeek } from '../components/chat/ChatPeek';
import { PromptModal } from '../components/chat/Modals';
import { SearchResults } from '../components/chat/SearchResults';
import { useChatTheme } from '../components/chat/useChatTheme';
import { client, ClientState } from '../lib/client';
import { deleteIfAppFile } from '../lib/media';
import { ChatMessage, Contact } from '../lib/types';

export function ContactsScreen({ state, onOpenSettings }: { state: ClientState; onOpenSettings: () => void }) {
  const { isDark, colors, styles } = useChatTheme();
  const [adding, setAdding] = useState(false);
  const [peek, setPeek] = useState<Contact | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatMessage[]>([]);
  const searching = query.trim().length >= 2;

  // Busqueda en todas las conversaciones (espera un momento a que termines de escribir)
  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const t = setTimeout(() => {
      client.searchAll(query).then((r) => !cancelled && setResults(r));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, searching]);

  const updateProfilePicture = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const picked = result.assets[0].uri;
    // Se achica aqui (el servidor ya no puede: la foto le llega cifrada) y al recodificar se quitan los datos EXIF/GPS
    let small: ImageManipulator.ImageResult;
    try {
      small = await ImageManipulator.manipulateAsync(picked, [{ resize: { width: 160, height: 160 } }], { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    } catch {
      Alert.alert('No se pudo usar la foto', 'Intenta con otra imagen.');
      return;
    } finally {
      await deleteIfAppFile(picked);
    }
    await deleteIfAppFile(small.uri);
    if (!small.base64 || !(await client.updateProfilePicture(small.base64))) Alert.alert('Sin conexión', 'Intenta de nuevo cuando haya conexión.');
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
        {/* Mismo estilo que el chat: tu perfil en una caja redondeada y botones redondos */}
        <View style={styles.topRow}>
          <View style={[styles.topBox, { paddingLeft: 8 }]}>
            <TouchableOpacity onPress={updateProfilePicture} activeOpacity={0.7}>
              <Avatar name={state.username} size={34} photoBase64={state.myProfilePicture} round />
            </TouchableOpacity>
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.topName} numberOfLines={1}>{state.username}</Text>
              <Text style={styles.topSub} numberOfLines={1}>
                <Text style={{ color: state.connected ? colors.primary : colors.danger }}>●</Text>{' '}
                {state.connected ? 'Conectado' : 'Sin conexión'}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onOpenSettings} style={styles.topRoundButton} activeOpacity={0.7}>
            <Text style={styles.topRoundIcon}>⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmLogout} style={styles.topRoundButton} activeOpacity={0.7}>
            <Text style={[styles.topRoundIcon, { color: colors.danger }]}>⏻</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.contactsTitle}>Chats</Text>
        <TextInput
          style={styles.searchPill}
          placeholder="🔍  Buscar en todos los chats"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />

        {searching ? (
          <SearchResults
            results={results}
            query={query.trim()}
            contacts={state.contacts}
            styles={styles}
            onOpen={(m) => {
              setQuery('');
              client.openConversation(m.peer, m.id);
            }}
          />
        ) : (

        <FlatList
          data={state.contacts}
          keyExtractor={(item) => item.username}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 96 }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyText}>TODAVÍA NO TIENES CONTACTOS</Text>
              <Text style={[styles.emptyText, { marginTop: 8, fontWeight: '400' }]}>Toca el botón + y escribe el usuario de la otra persona</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.contactCard}
              onPress={() => client.openConversation(item.username)}
              onLongPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                setPeek(item);
              }}
              delayLongPress={350}
              activeOpacity={0.7}
            >
              <View>
                <Avatar name={item.username} size={48} photoBase64={item.profilePicture} round />
                <View style={[styles.contactOnlineDot, { backgroundColor: item.online ? colors.primary : colors.textMuted }]} />
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.contactName} numberOfLines={1}>{item.username}</Text>
                {state.typing[item.username] ? (
                  <Text style={[styles.contactSub, { color: colors.accent, fontWeight: '700' }]} numberOfLines={1}>
                    {state.typing[item.username] === 'recording' ? 'grabando audio…' : 'escribiendo…'}
                  </Text>
                ) : item.identityChanged ? (
                  <Text style={[styles.contactSub, { color: colors.danger, fontWeight: '700' }]} numberOfLines={1}>⚠ Su llave de seguridad cambió</Text>
                ) : (
                  <Text style={styles.contactSub} numberOfLines={1}>
                    {item.online ? 'En línea' : 'Sin conexión'}
                    {item.verified ? '  ·  ✔ Verificado' : ''}
                  </Text>
                )}
              </View>
              {item.unread > 0 && (
                <View style={styles.contactUnread}>
                  <Text style={styles.contactUnreadText}>{item.unread > 99 ? '99+' : item.unread}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        />

        )}

        <TouchableOpacity style={styles.fab} onPress={() => setAdding(true)} activeOpacity={0.8}>
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      </SafeAreaView>
      <ChatPeek
        contact={peek}
        epoch={state.cacheEpoch}
        styles={styles}
        colors={colors}
        onClose={() => setPeek(null)}
        onOpen={(peer) => {
          setPeek(null);
          client.openConversation(peer);
        }}
      />
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
