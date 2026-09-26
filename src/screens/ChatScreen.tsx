import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ImageViewing from 'react-native-image-viewing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/chat/Avatar';
import { describeMessage, MessageBubble } from '../components/chat/MessageBubble';
import { MessageActions } from '../components/chat/Modals';
import { useChatTheme } from '../components/chat/useChatTheme';
import { client, ClientState } from '../lib/client';
import { log } from '../lib/log';
import { deleteIfAppFile } from '../lib/media';
import { ChatMessage } from '../lib/types';
import { ContactInfoScreen } from './ContactInfoScreen';

const STICKERS = ['🦅', '🎖️', '🫡', '💪', '🔥', '❤️', '😂', '👍', '💥', '🎯', '☕', '🌙'];

// Se recuerda mientras la app esta abierta, por contacto
const selfDestructByPeer = new Map<string, boolean>();

export function ChatScreen({ state, peer }: { state: ClientState; peer: string }) {
  const { isDark, colors, styles } = useChatTheme();
  const contact = state.contacts.find((c) => c.username === peer);

  const [inputText, setInputText] = useState('');
  const [showStickers, setShowStickers] = useState(false);
  const [selfDestruct, setSelfDestruct] = useState(!!selfDestructByPeer.get(peer));
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
  const [zoomUri, setZoomUri] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [showInfo, setShowInfo] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const messages = state.messages;
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const searching = searchOpen && searchQuery.trim().length > 0;

  useEffect(() => {
    if (searching || messages.length === 0) return;
    const timer = setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages, searching]);

  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    client.searchMessages(peer, searchQuery).then((r) => !cancelled && setSearchResults(r));
    return () => {
      cancelled = true;
    };
  }, [peer, searchQuery, searching, messages]);

  useEffect(() => () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
  }, []);

  const toggleSelfDestruct = () => {
    selfDestructByPeer.set(peer, !selfDestruct);
    setSelfDestruct(!selfDestruct);
  };

  const send = () => {
    const text = inputText;
    if (text.trim() === '') return;
    setInputText('');
    if (editing) {
      client.editMessage(peer, editing.id, text);
      setEditing(null);
      return;
    }
    client.sendText(peer, text, { replyTo: replyTo?.id ?? null, selfDestruct });
    setReplyTo(null);
  };

  const sendSticker = (emoji: string) => {
    setShowStickers(false);
    client.sendSticker(peer, emoji, { selfDestruct });
  };

  const pickMedia = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.4, videoMaxDuration: 30 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.uri) return;
    const isVideo = asset.type === 'video';

    let uri = asset.uri;
    if (!isVideo) {
      try {
        const manipulated = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1600 } }], {
          compress: 0.5,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        uri = manipulated.uri;
      } catch (e) {
        log('No se pudo reducir la imagen, se usa la original:', e);
      }
    }
    try {
      await client.sendMedia(peer, uri, isVideo ? 'video' : 'image', { replyTo: replyTo?.id ?? null, selfDestruct });
      setReplyTo(null);
    } catch (e) {
      Alert.alert('No se pudo preparar el archivo', String((e as Error)?.message ?? e));
    } finally {
      // La copia sin cifrar que dejo el selector en la carpeta temporal no se queda en el telefono
      if (uri !== asset.uri) deleteIfAppFile(asset.uri);
    }
  };

  const startRecording = async () => {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch (e) {
      log('Error iniciando la grabacion:', e);
    }
  };

  const stopRecordingAndSend = async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const durationSeconds = recordingSeconds;
    setIsRecording(false);
    setRecordingSeconds(0);
    try {
      await audioRecorder.stop();
    } catch {
      return;
    }
    const localUri = audioRecorder.uri;
    if (!localUri) return;
    if (durationSeconds < 1) {
      deleteIfAppFile(localUri);
      return;
    }
    try {
      await client.sendMedia(peer, localUri, 'voice', { duration: durationSeconds, replyTo: replyTo?.id ?? null, selfDestruct });
      setReplyTo(null);
    } catch (e) {
      Alert.alert('No se pudo preparar la nota de voz', String((e as Error)?.message ?? e));
    }
  };

  const startEdit = (m: ChatMessage) => {
    setReplyTo(null);
    setEditing(m);
    setInputText(m.body);
  };

  const confirmDeleteForEveryone = (m: ChatMessage) => {
    Alert.alert('Borrar para todos', 'El mensaje se borrará también en el teléfono de la otra persona.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => client.deleteForEveryone(peer, m.id) },
    ]);
  };

  if (showInfo) return <ContactInfoScreen state={state} peer={peer} onClose={() => setShowInfo(false)} />;

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
          <View style={styles.chatHeader}>
            <TouchableOpacity onPress={() => client.openConversation(null)} style={styles.backTouchable}>
              <Text style={styles.backChevron}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => setShowInfo(true)} activeOpacity={0.7}>
              <Avatar name={peer} size={36} photoBase64={contact?.profilePicture} />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={styles.chatHeaderName}>{peer.toUpperCase()}</Text>
                <Text style={styles.chatHeaderSub}>
                  {contact?.online ? 'EN LÍNEA' : 'SIN CONEXIÓN'} · {contact?.verified ? 'VERIFICADO' : 'CANAL CIFRADO'}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setSearchOpen(!searchOpen); setSearchQuery(''); }} style={styles.headerIconButton} activeOpacity={0.7}>
              <Text style={styles.headerIconText}>🔍</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={toggleSelfDestruct}
              style={[styles.logoutButton, { marginLeft: 4 }, selfDestruct && styles.selfDestructActive]}
              activeOpacity={0.7}
            >
              <Text style={styles.logoutButtonText}>⏱ {selfDestruct ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>

          {contact?.identityChanged && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                ⚠ La llave de seguridad de {peer} cambió. Puede ser que reinstaló la app o cambió de teléfono, pero también podría ser alguien haciéndose pasar por esa persona. Tus mensajes quedan en espera hasta que la aceptes.
              </Text>
              <View style={styles.bannerButtons}>
                <TouchableOpacity style={styles.bannerButton} onPress={() => setShowInfo(true)}>
                  <Text style={styles.bannerButtonText}>VER NÚMERO</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bannerButton} onPress={() => client.acceptIdentity(peer)}>
                  <Text style={styles.bannerButtonText}>ACEPTAR</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {searchOpen && (
            <View style={styles.searchBar}>
              <TextInput
                style={styles.searchInput}
                placeholder="buscar en la conversación..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
            </View>
          )}

          <FlatList
            ref={flatListRef}
            data={searching ? searchResults : messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            ListEmptyComponent={
              searching ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>SIN RESULTADOS</Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                quoted={item.replyTo ? byId.get(item.replyTo) ?? null : null}
                me={state.username}
                peer={peer}
                epoch={state.cacheEpoch}
                styles={styles}
                onLongPress={setActionTarget}
                onZoom={setZoomUri}
                onRetrySend={(id) => client.retrySend(id)}
                onRetryDownload={(id) => client.retryDownload(id)}
              />
            )}
          />

          {showStickers && (
            <View style={styles.stickerPanel}>
              <FlatList
                data={STICKERS}
                keyExtractor={(item) => item}
                numColumns={6}
                renderItem={({ item }) => (
                  <TouchableOpacity onPress={() => sendSticker(item)} style={styles.stickerOption} activeOpacity={0.6}>
                    <Text style={styles.stickerOptionText}>{item}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {(replyTo || editing) && (
            <View style={styles.replyBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarLabel}>{editing ? 'EDITANDO MENSAJE' : `RESPONDIENDO A ${(replyTo!.fromMe ? state.username : peer).toUpperCase()}`}</Text>
                <Text style={styles.replyBarText} numberOfLines={1}>{describeMessage(editing || replyTo)}</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (editing) setInputText('');
                  setEditing(null);
                  setReplyTo(null);
                }}
              >
                <Text style={styles.replyBarClose}>✕</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.inputRow}>
            {!editing && (
              <>
                <TouchableOpacity style={styles.attachButton} onPress={() => setShowStickers((v) => !v)} activeOpacity={0.7}>
                  <Text style={styles.attachButtonIcon}>😀</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.attachButton} onPress={pickMedia} activeOpacity={0.7}>
                  <Text style={styles.attachButtonIcon}>📎</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.attachButton, isRecording && styles.attachButtonRecording]}
                  onPress={isRecording ? stopRecordingAndSend : startRecording}
                  activeOpacity={0.7}
                >
                  <Text style={styles.attachButtonIcon}>{isRecording ? '⏹' : '🎤'}</Text>
                </TouchableOpacity>
              </>
            )}
            {isRecording ? (
              <View style={styles.recordingIndicator}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>Grabando... {recordingSeconds}s · toca otra vez para enviar</Text>
              </View>
            ) : (
              <TextInput
                style={styles.messageInput}
                placeholder={editing ? 'editar mensaje...' : 'redactar mensaje...'}
                placeholderTextColor={colors.textMuted}
                value={inputText}
                onChangeText={setInputText}
                multiline
              />
            )}
            <TouchableOpacity style={styles.sendButton} onPress={send} activeOpacity={0.8}>
              <Text style={styles.sendButtonIcon}>{editing ? '✓' : '➤'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <MessageActions
        message={actionTarget}
        me={state.username}
        styles={styles}
        onClose={() => setActionTarget(null)}
        onReply={(m) => {
          setEditing(null);
          setReplyTo(m);
        }}
        onEdit={startEdit}
        onDeleteForEveryone={confirmDeleteForEveryone}
        onDeleteForMe={(m) => client.deleteForMe(m.id)}
        onReact={(m, emoji) => client.react(peer, m.id, emoji)}
      />
      <ImageViewing images={zoomUri ? [{ uri: zoomUri }] : []} imageIndex={0} visible={!!zoomUri} onRequestClose={() => setZoomUri(null)} />
    </>
  );
}
