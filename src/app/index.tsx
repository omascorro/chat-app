import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import 'react-native-get-random-values';
import { SafeAreaView } from 'react-native-safe-area-context';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const SERVER_URL = 'wss://chat-backend-p5ny.onrender.com';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Paleta "operaciones diurnas" (light) y "operaciones nocturnas" (dark)
const LIGHT_COLORS = {
  bg: '#EDE9DC',
  card: '#F7F4E9',
  primary: '#4B5320',
  accent: '#B8862E',
  text: '#242018',
  textMuted: '#7A745F',
  bubbleMine: '#4B5320',
  bubbleTheirs: '#DCD6C1',
  border: '#B9B196',
  danger: '#8C2F1E',
};

const DARK_COLORS = {
  bg: '#15170F',
  card: '#20231A',
  primary: '#6B7A3A',
  accent: '#D4A24C',
  text: '#EDEAD9',
  textMuted: '#8C917A',
  bubbleMine: '#4B5320',
  bubbleTheirs: '#2B2E22',
  border: '#3A3E2C',
  danger: '#C0432E',
};

const AVATAR_PALETTE = ['#4B5320', '#B8862E', '#5C6B32', '#8C2F1E', '#6B7A3A', '#7A6A3E'];

function avatarColor(name: string) {
  const sum = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type OnlineUser = { username: string; publicKey: string; online: boolean };
type Message = { id: string; text: string; kind: 'text' | 'image'; sentByMe: boolean; timestamp: number };
type RatchetState = { sendChain: Uint8Array; recvChain: Uint8Array };

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function deriveKey(chainKey: Uint8Array, label: string): Uint8Array {
  const labelBytes = util.decodeUTF8(label);
  const hash = nacl.hash(concatBytes(chainKey, labelBytes));
  return hash.slice(0, 32);
}

function initRatchet(myUsername: string, theirUsername: string, theirPublicKeyB64: string, mySecretKey: Uint8Array): RatchetState {
  const sharedSecret = nacl.box.before(util.decodeBase64(theirPublicKeyB64), mySecretKey);
  const chainA = deriveKey(sharedSecret, 'A2B_INIT');
  const chainB = deriveKey(sharedSecret, 'B2A_INIT');
  const amFirst = myUsername < theirUsername;
  return {
    sendChain: amFirst ? chainA : chainB,
    recvChain: amFirst ? chainB : chainA,
  };
}

async function persistRatchet(myUsername: string, theirUsername: string, state: RatchetState) {
  const storageKey = `ratchet_${myUsername}_${theirUsername}`;
  try {
    await SecureStore.setItemAsync(storageKey, JSON.stringify({
      sendChain: util.encodeBase64(state.sendChain),
      recvChain: util.encodeBase64(state.recvChain),
    }));
  } catch (e) {
    console.log('No se pudo guardar el estado del ratchet:', e);
  }
}

async function loadOrCreateRatchet(myUsername: string, theirUsername: string, theirPublicKeyB64: string, mySecretKey: Uint8Array): Promise<RatchetState> {
  const storageKey = `ratchet_${myUsername}_${theirUsername}`;
  const stored = await SecureStore.getItemAsync(storageKey);
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      sendChain: util.decodeBase64(parsed.sendChain),
      recvChain: util.decodeBase64(parsed.recvChain),
    };
  }
  const fresh = initRatchet(myUsername, theirUsername, theirPublicKeyB64, mySecretKey);
  await persistRatchet(myUsername, theirUsername, fresh);
  return fresh;
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={[avatarStyles.square, { width: size, height: size, borderRadius: size * 0.18, backgroundColor: avatarColor(name) }]}>
      <Text style={[avatarStyles.letter, { fontSize: size * 0.42 }]}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export default function ChatScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const COLORS = isDark ? DARK_COLORS : LIGHT_COLORS;
  const styles = useMemo(() => createStyles(COLORS), [isDark]);

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');

  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<OnlineUser | null>(null);
  const [conversations, setConversations] = useState<Record<string, Message[]>>({});
  const [inputText, setInputText] = useState('');

  const ws = useRef<WebSocket | null>(null);
  const myKeys = useRef<nacl.BoxKeyPair | null>(null);
  const ratchets = useRef<Record<string, RatchetState>>({});
  const onlineUsersRef = useRef<OnlineUser[]>([]);
  const pendingAuth = useRef<{ username: string; password: string } | null>(null);
  const usernameRef = useRef('');
  const shouldReconnect = useRef(true);
  const hasLoadedHistory = useRef(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => { onlineUsersRef.current = onlineUsers; }, [onlineUsers]);
  useEffect(() => { usernameRef.current = username; }, [username]);

  useEffect(() => {
    if (!selectedUser) return;
    const msgs = conversations[selectedUser.username] || [];
    if (msgs.length === 0) return;
    const timer = setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedUser, conversations]);

  useEffect(() => {
    if (!authenticated || username === '') return;
    AsyncStorage.setItem(`messages_${username}`, JSON.stringify(conversations));
  }, [conversations, authenticated, username]);

  const registerForPushNotifications = async () => {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Mensajes',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#6B7A3A',
        });
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        console.log('Permiso de notificaciones no concedido');
        return;
      }
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      ws.current?.send(JSON.stringify({ type: 'register-push-token', token: tokenData.data }));
      console.log('🔔 Token de notificaciones registrado');
    } catch (e) {
      console.log('Error registrando notificaciones:', e);
    }
  };

  const reauthenticate = (socket: WebSocket) => {
    if (!pendingAuth.current || !myKeys.current) return;
    socket.send(JSON.stringify({
      type: 'login',
      username: pendingAuth.current.username,
      password: pendingAuth.current.password,
      publicKey: util.encodeBase64(myKeys.current.publicKey),
    }));
  };

  const handleSocketMessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data);

    if (data.type === 'register-result') {
      if (data.success && pendingAuth.current && ws.current) {
        ws.current.send(JSON.stringify({
          type: 'login',
          username: pendingAuth.current.username,
          password: pendingAuth.current.password,
          publicKey: util.encodeBase64(myKeys.current!.publicKey),
        }));
      } else {
        setAuthError(data.error || 'Error al registrar');
      }
      return;
    }

    if (data.type === 'login-result') {
      if (data.success && pendingAuth.current) {
        usernameRef.current = pendingAuth.current.username;
        setUsername(pendingAuth.current.username);
        setAuthenticated(true);
        setAuthError('');

        if (!hasLoadedHistory.current) {
          hasLoadedHistory.current = true;
          AsyncStorage.getItem(`messages_${pendingAuth.current.username}`).then((stored) => {
            if (stored) setConversations(JSON.parse(stored));
          });
        }
        registerForPushNotifications();
      } else {
        setAuthError(data.error || 'Error al iniciar sesión');
      }
      return;
    }

    if (data.type === 'user-list') {
      const others = data.users.filter((u: OnlineUser) => u.username !== usernameRef.current);
      setOnlineUsers(others);
      return;
    }

    if (data.type === 'direct-message') {
      const sender = data.from;

      (async () => {
        if (!ratchets.current[sender]) {
          const senderPublicKey = data.fromPublicKey || onlineUsersRef.current.find((u) => u.username === sender)?.publicKey;
          if (!senderPublicKey || !myKeys.current) return;
          ratchets.current[sender] = await loadOrCreateRatchet(usernameRef.current, sender, senderPublicKey, myKeys.current.secretKey);
        }

        const state = ratchets.current[sender];
        const messageKey = deriveKey(state.recvChain, 'MSG');
        const decrypted = nacl.secretbox.open(util.decodeBase64(data.ciphertext), util.decodeBase64(data.nonce), messageKey);
        if (!decrypted) {
          console.log('🔴 FALLÓ AL DESCIFRAR el mensaje de', sender, '— probablemente el ratchet está desincronizado');
          return;
        }
        console.log('🟢 Descifrado correctamente');
        state.recvChain = deriveKey(state.recvChain, 'NEXT');
        persistRatchet(usernameRef.current, sender, state);

        const payloadStr = util.encodeUTF8(decrypted);
        let parsed: { kind: 'text' | 'image'; content: string };
        try {
          parsed = JSON.parse(payloadStr);
        } catch (e) {
          parsed = { kind: 'text', content: payloadStr };
        }

        const newMsg: Message = {
          id: Date.now().toString() + Math.random(),
          text: parsed.content,
          kind: parsed.kind || 'text',
          sentByMe: false,
          timestamp: Date.now(),
        };
        setConversations((prev) => ({ ...prev, [sender]: [...(prev[sender] || []), newMsg] }));
      })();
    }
  };

  const connectWebSocket = () => {
    const socket = new WebSocket(SERVER_URL);
    ws.current = socket;

    socket.onopen = () => {
      setConnected(true);
      if (pendingAuth.current && authenticated) {
        reauthenticate(socket);
      }
    };

    socket.onclose = () => {
      setConnected(false);
      if (shouldReconnect.current) {
        setTimeout(() => {
          if (shouldReconnect.current) connectWebSocket();
        }, 2000);
      }
    };

    socket.onmessage = handleSocketMessage;
  };

  useEffect(() => {
    shouldReconnect.current = true;
    connectWebSocket();
    return () => {
      shouldReconnect.current = false;
      ws.current?.close();
    };
  }, []);

  const submitAuth = async () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    const uname = usernameInput.trim();
    if (uname === '' || passwordInput === '') {
      setAuthError('Completa usuario y contraseña');
      return;
    }
    setAuthError('');

    const storageKey = `identity_${uname}`;
    let keyPair: nacl.BoxKeyPair;

    const stored = await SecureStore.getItemAsync(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      keyPair = { publicKey: util.decodeBase64(parsed.publicKey), secretKey: util.decodeBase64(parsed.secretKey) };
    } else {
      keyPair = nacl.box.keyPair();
      await SecureStore.setItemAsync(storageKey, JSON.stringify({
        publicKey: util.encodeBase64(keyPair.publicKey),
        secretKey: util.encodeBase64(keyPair.secretKey),
      }));
    }

    myKeys.current = keyPair;
    pendingAuth.current = { username: uname, password: passwordInput };

    ws.current.send(JSON.stringify({
      type: authMode,
      username: uname,
      password: passwordInput,
      publicKey: util.encodeBase64(keyPair.publicKey),
    }));
  };

  const logout = () => {
    pendingAuth.current = null;
    hasLoadedHistory.current = false;
    ratchets.current = {};
    myKeys.current = null;
    setAuthenticated(false);
    setUsername('');
    setSelectedUser(null);
    setOnlineUsers([]);
    setConversations({});
    setUsernameInput('');
    setPasswordInput('');
    ws.current?.close();
  };

  const resetEncryption = async () => {
    if (!selectedUser) return;
    const storageKey = `ratchet_${username}_${selectedUser.username}`;
    await SecureStore.deleteItemAsync(storageKey);
    delete ratchets.current[selectedUser.username];
    if (myKeys.current) {
      ratchets.current[selectedUser.username] = await loadOrCreateRatchet(username, selectedUser.username, selectedUser.publicKey, myKeys.current.secretKey);
    }
    console.log('🔄 Cifrado reiniciado para', selectedUser.username);
  };

  const openConversation = async (user: OnlineUser) => {
    if (!ratchets.current[user.username] && myKeys.current) {
      ratchets.current[user.username] = await loadOrCreateRatchet(username, user.username, user.publicKey, myKeys.current.secretKey);
    }
    setSelectedUser(user);
  };

  const sendMessage = () => {
    if (inputText.trim() === '' || !selectedUser) return;
    const state = ratchets.current[selectedUser.username];
    if (!state) return;
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      console.log('⚠️ No se pudo enviar: sin conexión en este momento');
      return;
    }

    const payload = JSON.stringify({ kind: 'text', content: inputText });
    const messageKey = deriveKey(state.sendChain, 'MSG');
    const nonce = nacl.randomBytes(24);
    const ciphertext = nacl.secretbox(util.decodeUTF8(payload), nonce, messageKey);
    state.sendChain = deriveKey(state.sendChain, 'NEXT');
    persistRatchet(username, selectedUser.username, state);

    ws.current.send(JSON.stringify({
      type: 'direct-message',
      to: selectedUser.username,
      ciphertext: util.encodeBase64(ciphertext),
      nonce: util.encodeBase64(nonce),
    }));

    const newMsg: Message = { id: Date.now().toString(), text: inputText, kind: 'text', sentByMe: true, timestamp: Date.now() };
    setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));
    setInputText('');
  };

  const sendImage = async () => {
    if (!selectedUser) return;
    const state = ratchets.current[selectedUser.username];
    if (!state) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      console.log('Permiso de galería no concedido');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.4,
      base64: true,
    });

    if (result.canceled || !result.assets || !result.assets[0].base64) return;
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      console.log('⚠️ No se pudo enviar: sin conexión en este momento');
      return;
    }

    const base64Image = result.assets[0].base64;
    const payload = JSON.stringify({ kind: 'image', content: base64Image });
    const messageKey = deriveKey(state.sendChain, 'MSG');
    const nonce = nacl.randomBytes(24);
    const ciphertext = nacl.secretbox(util.decodeUTF8(payload), nonce, messageKey);
    state.sendChain = deriveKey(state.sendChain, 'NEXT');
    persistRatchet(username, selectedUser.username, state);

    ws.current.send(JSON.stringify({
      type: 'direct-message',
      to: selectedUser.username,
      ciphertext: util.encodeBase64(ciphertext),
      nonce: util.encodeBase64(nonce),
    }));

    const newMsg: Message = { id: Date.now().toString(), text: base64Image, kind: 'image', sentByMe: true, timestamp: Date.now() };
    setConversations((prev) => ({ ...prev, [selectedUser.username]: [...(prev[selectedUser.username] || []), newMsg] }));
  };

  if (!authenticated) {
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
              <View style={[styles.dot, { backgroundColor: connected ? '#6B7A3A' : '#C0432E' }]} />
              <Text style={styles.connectionText}>{connected ? 'ENLACE ACTIVO' : 'CONECTANDO...'}</Text>
            </View>

            <Text style={styles.formTitle}>{authMode === 'login' ? 'ACCESO AUTORIZADO' : 'ALTA DE OPERADOR'}</Text>

            <Text style={styles.inputLabel}>IDENTIFICADOR</Text>
            <TextInput
              style={styles.input}
              placeholder="usuario"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              value={usernameInput}
              onChangeText={setUsernameInput}
            />
            <Text style={styles.inputLabel}>CLAVE DE ACCESO</Text>
            <TextInput
              style={styles.input}
              placeholder="contraseña"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
              value={passwordInput}
              onChangeText={setPasswordInput}
            />

            {authError !== '' && <Text style={styles.errorText}>⚠ {authError}</Text>}

            <TouchableOpacity style={styles.primaryButton} onPress={submitAuth} activeOpacity={0.8}>
              <Text style={styles.primaryButtonText}>{authMode === 'login' ? 'INGRESAR' : 'REGISTRAR'}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>
              <Text style={styles.switchText}>
                {authMode === 'login' ? 'SIN CREDENCIALES · ' : 'YA REGISTRADO · '}
                <Text style={styles.switchTextBold}>{authMode === 'login' ? 'DAR DE ALTA' : 'INICIAR SESIÓN'}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </>
    );
  }

  if (!selectedUser) {
    return (
      <>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Avatar name={username} size={40} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.headerTitle}>{username.toUpperCase()}</Text>
                <Text style={styles.headerSubtitle}>{connected ? '● ENLACE ACTIVO' : '● SIN ENLACE'}</Text>
              </View>
              <TouchableOpacity onPress={logout} style={styles.logoutButton} activeOpacity={0.7}>
                <Text style={styles.logoutButtonText}>SALIR</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.sectionDivider}>
            <Text style={styles.sectionTitle}>REGISTRO DE CONTACTOS</Text>
          </View>

          <FlatList
            data={[...onlineUsers].sort((a, b) => Number(b.online) - Number(a.online))}
            keyExtractor={(item) => item.username}
            contentContainerStyle={{ paddingHorizontal: 16 }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🦅</Text>
                <Text style={styles.emptyText}>SIN CONTACTOS REGISTRADOS</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.userRow} onPress={() => openConversation(item)} activeOpacity={0.7}>
                <View>
                  <Avatar name={item.username} />
                  <View style={[styles.statusDot, { backgroundColor: item.online ? '#6B7A3A' : '#7A745F' }]} />
                </View>
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={styles.userName}>{item.username.toUpperCase()}</Text>
                  <Text style={styles.userStatus}>{item.online ? 'EN LÍNEA' : 'SIN CONEXIÓN'}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </>
    );
  }

  const messages = conversations[selectedUser.username] || [];

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
          <View style={styles.chatHeader}>
            <TouchableOpacity onPress={() => setSelectedUser(null)} style={styles.backTouchable}>
              <Text style={styles.backChevron}>‹</Text>
            </TouchableOpacity>
            <Avatar name={selectedUser.username} size={36} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.chatHeaderName}>{selectedUser.username.toUpperCase()}</Text>
              <Text style={styles.chatHeaderSub}>
                {selectedUser.online ? 'EN LÍNEA' : 'SIN CONEXIÓN'} · CANAL CIFRADO
              </Text>
            </View>
            <TouchableOpacity onPress={resetEncryption} style={styles.logoutButton} activeOpacity={0.7}>
              <Text style={styles.logoutButtonText}>REINICIAR</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            renderItem={({ item }) => (
              <View style={{ alignItems: item.sentByMe ? 'flex-end' : 'flex-start', marginVertical: 3 }}>
                <View style={[
                  styles.bubble,
                  item.sentByMe ? styles.myBubble : styles.theirBubble,
                  item.kind === 'image' && styles.imageBubble,
                ]}>
                  {item.kind === 'image' ? (
                    <Image source={{ uri: `data:image/jpeg;base64,${item.text}` }} style={styles.messageImage} resizeMode="cover" />
                  ) : (
                    <Text style={item.sentByMe ? styles.myText : styles.theirText}>{item.text}</Text>
                  )}
                </View>
                <Text style={styles.timestamp}>{formatTime(item.timestamp)}</Text>
              </View>
            )}
          />

          <View style={styles.inputRow}>
            <TouchableOpacity style={styles.attachButton} onPress={sendImage} activeOpacity={0.7}>
              <Text style={styles.attachButtonIcon}>📎</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.messageInput}
              placeholder="redactar mensaje..."
              placeholderTextColor={COLORS.textMuted}
              value={inputText}
              onChangeText={setInputText}
              multiline
            />
            <TouchableOpacity style={styles.sendButton} onPress={sendMessage} activeOpacity={0.8}>
              <Text style={styles.sendButtonIcon}>➤</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const avatarStyles = StyleSheet.create({
  square: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#fff', fontWeight: '800' },
});

function createStyles(COLORS: typeof LIGHT_COLORS) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.bg },
    authWrapper: { flex: 1, backgroundColor: '#4B5320' },
    authCard: {
      flex: 1,
      backgroundColor: COLORS.bg,
      marginTop: 90,
      paddingHorizontal: 26,
      paddingTop: 32,
      alignItems: 'center',
      borderTopWidth: 3,
      borderTopColor: COLORS.accent,
    },
    logoBadge: {
      width: 66, height: 66, borderRadius: 10,
      backgroundColor: COLORS.primary,
      alignItems: 'center', justifyContent: 'center',
      marginTop: -70,
      marginBottom: 14,
      borderWidth: 2,
      borderColor: COLORS.accent,
    },
    logoText: { fontSize: 30 },
    appName: { fontSize: 22, fontWeight: '800', color: COLORS.text, letterSpacing: 3 },
    appNameUnderline: { width: 40, height: 3, backgroundColor: COLORS.accent, marginTop: 8, marginBottom: 12 },
    appTagline: { fontSize: 12, color: COLORS.textMuted, marginBottom: 20, textAlign: 'center', lineHeight: 17, fontStyle: 'italic' },
    connectionPill: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: COLORS.card, borderRadius: 3,
      paddingHorizontal: 12, paddingVertical: 6, marginBottom: 22,
      borderWidth: 1, borderColor: COLORS.border,
    },
    dot: { width: 7, height: 7, borderRadius: 4, marginRight: 7 },
    connectionText: { fontSize: 10, color: COLORS.textMuted, letterSpacing: 1, fontWeight: '700' },
    formTitle: { fontSize: 13, fontWeight: '800', color: COLORS.accent, alignSelf: 'flex-start', marginBottom: 16, letterSpacing: 1.5 },
    inputLabel: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted, alignSelf: 'flex-start', letterSpacing: 1, marginBottom: 4 },
    input: {
      width: '100%', backgroundColor: COLORS.card,
      borderRadius: 2, padding: 12, fontSize: 15, color: COLORS.text,
      marginBottom: 14, borderWidth: 1, borderColor: COLORS.border,
    },
    errorText: { color: COLORS.danger, fontSize: 12, marginBottom: 10, alignSelf: 'flex-start', fontWeight: '600' },
    primaryButton: {
      width: '100%', backgroundColor: COLORS.accent,
      borderRadius: 2, paddingVertical: 14, alignItems: 'center', marginTop: 6,
    },
    primaryButtonText: { color: '#1A1712', fontWeight: '800', fontSize: 14, letterSpacing: 1.5 },
    switchText: { color: COLORS.textMuted, marginTop: 18, fontSize: 11, letterSpacing: 0.5 },
    switchTextBold: { color: COLORS.accent, fontWeight: '800' },
    header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, backgroundColor: COLORS.card, borderBottomWidth: 2, borderBottomColor: COLORS.primary },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    headerTitle: { fontSize: 15, fontWeight: '800', color: COLORS.text, letterSpacing: 1 },
    headerSubtitle: { fontSize: 10, color: COLORS.textMuted, marginTop: 2, fontWeight: '600', letterSpacing: 0.5 },
    logoutButton: {
      borderWidth: 1, borderColor: COLORS.border, borderRadius: 2,
      paddingHorizontal: 10, paddingVertical: 6,
    },
    logoutButtonText: { fontSize: 10, fontWeight: '800', color: COLORS.danger, letterSpacing: 1 },
    sectionDivider: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
    sectionTitle: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1.5 },
    userRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: COLORS.card, borderRadius: 3,
      padding: 12, marginBottom: 8,
      borderWidth: 1, borderColor: COLORS.border,
      borderLeftWidth: 3, borderLeftColor: COLORS.primary,
    },
    userName: { fontSize: 13, fontWeight: '700', color: COLORS.text, letterSpacing: 0.5 },
    userStatus: { fontSize: 10, color: COLORS.textMuted, marginTop: 2, fontWeight: '600', letterSpacing: 0.5 },
    chevron: { fontSize: 22, color: COLORS.textMuted },
    statusDot: {
      position: 'absolute', bottom: -2, right: -2,
      width: 12, height: 12, borderRadius: 3,
      borderWidth: 2, borderColor: COLORS.bg,
    },
    emptyState: { alignItems: 'center', marginTop: 60 },
    emptyEmoji: { fontSize: 32, marginBottom: 8 },
    emptyText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    chatHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: COLORS.card, borderBottomWidth: 2, borderBottomColor: COLORS.primary,
    },
    backTouchable: { paddingRight: 6, paddingVertical: 4 },
    backChevron: { fontSize: 30, color: COLORS.accent, fontWeight: '300' },
    chatHeaderName: { fontSize: 14, fontWeight: '800', color: COLORS.text, letterSpacing: 0.5 },
    chatHeaderSub: { fontSize: 10, color: COLORS.textMuted, marginTop: 1, fontWeight: '600', letterSpacing: 0.3 },
    messageList: { padding: 14, paddingBottom: 10 },
    bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 3 },
    imageBubble: { padding: 4 },
    messageImage: { width: 220, height: 220, borderRadius: 2 },
    myBubble: { backgroundColor: COLORS.bubbleMine, borderTopRightRadius: 0 },
    theirBubble: { backgroundColor: COLORS.bubbleTheirs, borderTopLeftRadius: 0, borderWidth: 1, borderColor: COLORS.border },
    myText: { color: '#F2F0E4', fontSize: 15, lineHeight: 20 },
    theirText: { color: COLORS.text, fontSize: 15, lineHeight: 20 },
    timestamp: { fontSize: 9, color: COLORS.textMuted, marginTop: 3, marginHorizontal: 4, fontWeight: '600' },
    inputRow: {
      flexDirection: 'row', alignItems: 'flex-end',
      paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: COLORS.card, borderTopWidth: 2, borderTopColor: COLORS.primary,
    },
    messageInput: {
      flex: 1, backgroundColor: COLORS.bg,
      borderRadius: 2, paddingHorizontal: 14, paddingVertical: 10,
      fontSize: 15, color: COLORS.text, maxHeight: 100, marginRight: 8,
      borderWidth: 1, borderColor: COLORS.border,
    },
    sendButton: {
      width: 42, height: 42, borderRadius: 3,
      backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center',
    },
    sendButtonIcon: { color: '#1A1712', fontSize: 16, fontWeight: '800' },
    attachButton: {
      width: 42, height: 42, borderRadius: 3,
      backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border,
      alignItems: 'center', justifyContent: 'center', marginRight: 8,
    },
    attachButtonIcon: { fontSize: 18 },
  });
}