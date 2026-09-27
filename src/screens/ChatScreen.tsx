import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ImageViewing from 'react-native-image-viewing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/chat/Avatar';
import { describeMessage, MessageBubble } from '../components/chat/MessageBubble';
import { MessageActions, OptionsModal } from '../components/chat/Modals';
import { useChatTheme } from '../components/chat/useChatTheme';
import { client, ClientState } from '../lib/client';
import { log } from '../lib/log';
import { decryptToCache, deleteIfAppFile, removeFromCache } from '../lib/media';
import { protectViewOnce } from '../lib/screenProtection';
import { useAppearance, wallpaperFor } from '../lib/appearance';
import { ChatWallpaper } from '../components/chat/ChatWallpaper';
import { StickerPanel } from '../components/chat/StickerPanel';
import { ChatMessage, formatTtl, shortTtl, TIMER_OPTIONS } from '../lib/types';
import { ContactInfoScreen } from './ContactInfoScreen';


export function ChatScreen({ state, peer }: { state: ClientState; peer: string }) {
  const { isDark, colors, styles } = useChatTheme();
  const appearance = useAppearance();
  const contact = state.contacts.find((c) => c.username === peer);
  const peerTyping = state.typing[peer];

  const [inputText, setInputText] = useState('');
  const [showStickers, setShowStickers] = useState(false);
  const [timerMenu, setTimerMenu] = useState(false);
  const [viewOnceOpen, setViewOnceOpen] = useState<{ id: string; uri: string } | null>(null);
  const timer = state.timers[peer] || 0;
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

  const messages = state.messages;
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const searching = searchOpen && searchQuery.trim().length > 0;
  // La lista va invertida (como WhatsApp): empieza abajo, en el ultimo mensaje, sin tener que desplazarse
  // despues de dibujarse. Por eso los datos van del mas nuevo al mas viejo.
  const listData = useMemo(() => [...(searching ? searchResults : messages)].reverse(), [searching, searchResults, messages]);

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
    // Al salir del chat ya no se esta escribiendo
    client.notifyTyping(peer, 'stop');
  }, [peer]);

  const openViewOnce = async (m: ChatMessage) => {
    if (!m.mediaFile || !m.media) return;
    try {
      // Mientras la foto de "ver una vez" esta abierta no se puede capturar la pantalla
      await protectViewOnce(true);
      setViewOnceOpen({ id: m.id, uri: await decryptToCache(m.id, 'image', m.mediaFile, m.media) });
    } catch (e) {
      protectViewOnce(false);
      Alert.alert('No se pudo abrir la foto', String((e as Error)?.message ?? e));
    }
  };

  const closeViewOnce = () => {
    if (!viewOnceOpen) return;
    const { id } = viewOnceOpen;
    setViewOnceOpen(null);
    protectViewOnce(false);
    removeFromCache(id);
    client.markViewOnceViewed(peer, id);
  };

  // Avisa al otro que estas escribiendo (el cliente limita cada cuanto se manda)
  const onChangeText = (text: string) => {
    setInputText(text);
    if (!editing) client.notifyTyping(peer, text.trim() ? 'start' : 'stop');
  };

  const send = () => {
    client.notifyTyping(peer, 'stop');
    const text = inputText;
    if (text.trim() === '') return;
    setInputText('');
    if (editing) {
      client.editMessage(peer, editing.id, text);
      setEditing(null);
      return;
    }
    client.sendText(peer, text, { replyTo: replyTo?.id ?? null });
    setReplyTo(null);
  };

  // Para fotos se pregunta si es normal o de "ver una vez"
  const askImageMode = () =>
    new Promise<'normal' | 'viewOnce' | null>((resolve) => {
      Alert.alert('Enviar foto', '¿Cómo quieres mandarla?', [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
        { text: 'Ver una vez', onPress: () => resolve('viewOnce') },
        { text: 'Normal', onPress: () => resolve('normal') },
      ], { cancelable: true, onDismiss: () => resolve(null) });
    });

  const pickMedia = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.4, videoMaxDuration: 30 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.uri) return;
    const isVideo = asset.type === 'video';
    let viewOnce = false;
    if (!isVideo) {
      const mode = await askImageMode();
      if (!mode) {
        deleteIfAppFile(asset.uri);
        return;
      }
      viewOnce = mode === 'viewOnce';
    }

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
      await client.sendMedia(peer, uri, isVideo ? 'video' : 'image', { replyTo: replyTo?.id ?? null, viewOnce });
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
      client.notifyTyping(peer, 'recording');
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
        client.notifyTyping(peer, 'recording');
      }, 1000);
    } catch (e) {
      log('Error iniciando la grabacion:', e);
    }
  };

  const stopRecordingAndSend = async () => {
    client.notifyTyping(peer, 'stop');
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
      await client.sendMedia(peer, localUri, 'voice', { duration: durationSeconds, replyTo: replyTo?.id ?? null });
      setReplyTo(null);
    } catch (e) {
      Alert.alert('No se pudo preparar la nota de voz', String((e as Error)?.message ?? e));
    }
  };

  // Descartar la grabacion sin mandarla
  const cancelRecording = async () => {
    client.notifyTyping(peer, 'stop');
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingSeconds(0);
    try {
      await audioRecorder.stop();
    } catch {
      return;
    }
    if (audioRecorder.uri) deleteIfAppFile(audioRecorder.uri);
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
          {/* Mismo estilo que la barra de escritura: una caja redondeada con el contacto y botones redondos */}
          <View style={styles.topRow}>
            <View style={styles.topBox}>
              <TouchableOpacity onPress={() => client.openConversation(null)} style={styles.topBack} activeOpacity={0.6}>
                <Text style={styles.topBackIcon}>‹</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.topContact} onPress={() => setShowInfo(true)} activeOpacity={0.7}>
                <Avatar name={peer} size={34} photoBase64={contact?.profilePicture} round />
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <Text style={styles.topName} numberOfLines={1}>{peer}</Text>
                  <Text style={styles.topSub} numberOfLines={1}>
                    {peerTyping ? (
                      <Text style={{ color: colors.accent, fontWeight: '700' }}>{peerTyping === 'recording' ? 'grabando audio…' : 'escribiendo…'}</Text>
                    ) : (
                      <>
                        <Text style={{ color: contact?.online ? colors.primary : colors.textMuted }}>●</Text>{' '}
                        {contact?.online ? 'En línea' : 'Sin conexión'} · {contact?.verified ? 'Verificado' : 'Cifrado'}
                      </>
                    )}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => { setSearchOpen(!searchOpen); setSearchQuery(''); }}
              style={[styles.topRoundButton, searchOpen && styles.topRoundButtonActive]}
              activeOpacity={0.7}
            >
              <Text style={styles.topRoundIcon}>🔍</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setTimerMenu(true)}
              style={[styles.topRoundButton, timer > 0 && styles.topRoundButtonActive, timer > 0 && { width: 'auto', paddingHorizontal: 12 }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.topRoundIcon, timer > 0 && styles.topRoundTextActive]}>⏱{timer > 0 ? ` ${shortTtl(timer)}` : ''}</Text>
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
            <View style={styles.topSearchRow}>
              <TextInput
                style={styles.topSearchInput}
                placeholder="Buscar en la conversación"
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
            </View>
          )}

          <ChatWallpaper wallpaper={wallpaperFor(appearance, peer)} fallbackColor={colors.bg}>
          {searching && searchResults.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>SIN RESULTADOS</Text>
            </View>
          )}
          <FlatList
            inverted
            style={{ flex: 1 }}
            data={listData}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
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
                onOpenViewOnce={openViewOnce}
              />
            )}
          />
          </ChatWallpaper>

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

          {/* Como WhatsApp: la caja con la camara adentro, y un solo boton redondo que es microfono
              cuando no hay texto y enviar cuando si hay */}
          <View style={styles.composerRow}>
            {isRecording ? (
              <View style={styles.composerBox}>
                <TouchableOpacity onPress={cancelRecording} style={styles.composerIconButton} activeOpacity={0.6}>
                  <Text style={styles.composerIcon}>🗑</Text>
                </TouchableOpacity>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>
                  {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')} · Grabando…
                </Text>
              </View>
            ) : (
              <View style={[styles.composerBox, !editing && { paddingLeft: 4 }]}>
                {!editing && (
                  <TouchableOpacity
                    onPress={() => {
                      Keyboard.dismiss();
                      setShowStickers((v) => !v);
                    }}
                    style={styles.composerIconButton}
                    activeOpacity={0.6}
                  >
                    <Text style={[styles.composerIcon, showStickers && { opacity: 0.5 }]}>🏷</Text>
                  </TouchableOpacity>
                )}
                <TextInput
                  style={styles.composerInput}
                  placeholder={editing ? 'Editar mensaje' : 'Mensaje'}
                  placeholderTextColor={colors.textMuted}
                  value={inputText}
                  onChangeText={onChangeText}
                  onFocus={() => setShowStickers(false)}
                  multiline
                />
                {!editing && (
                  <TouchableOpacity onPress={pickMedia} style={styles.composerIconButton} activeOpacity={0.6}>
                    <Text style={styles.composerIcon}>📷</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {isRecording ? (
              <TouchableOpacity style={[styles.composerAction, styles.composerActionRecording]} onPress={stopRecordingAndSend} activeOpacity={0.8}>
                <Text style={styles.composerActionIcon}>➤</Text>
              </TouchableOpacity>
            ) : inputText.trim() !== '' || editing ? (
              <TouchableOpacity style={styles.composerAction} onPress={send} activeOpacity={0.8}>
                <Text style={styles.composerActionIcon}>{editing ? '✓' : '➤'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.composerAction} onPress={startRecording} activeOpacity={0.8}>
                <Text style={styles.composerActionIcon}>🎤</Text>
              </TouchableOpacity>
            )}
          </View>

          {showStickers && !editing && (
            <StickerPanel
              epoch={state.cacheEpoch}
              styles={styles}
              colors={colors}
              onSend={(id) => {
                client.sendStickerImage(peer, id).catch((e) => Alert.alert('No se pudo mandar el sticker', String((e as Error)?.message ?? e)));
              }}
            />
          )}
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
        onSaveSticker={async (m) => {
          try {
            const added = await client.saveReceivedSticker(m.id);
            Alert.alert(added ? 'Sticker guardado' : 'Ya lo tenías', added ? 'Lo encuentras en tus stickers.' : 'Ese sticker ya está en tus stickers.');
          } catch (e) {
            Alert.alert('No se pudo guardar', String((e as Error)?.message ?? e));
          }
        }}
        onReact={(m, emoji) => client.react(peer, m.id, emoji)}
      />
      <ImageViewing images={zoomUri ? [{ uri: zoomUri }] : []} imageIndex={0} visible={!!zoomUri} onRequestClose={() => setZoomUri(null)} />
      <ImageViewing
        images={viewOnceOpen ? [{ uri: viewOnceOpen.uri }] : []}
        imageIndex={0}
        visible={!!viewOnceOpen}
        onRequestClose={closeViewOnce}
        swipeToCloseEnabled={false}
      />
      <OptionsModal
        visible={timerMenu}
        title="MENSAJES TEMPORALES"
        message={`Los mensajes nuevos se borran de los dos teléfonos después de este tiempo (para ${peer}, desde que los lee). El ajuste cambia también en su teléfono.`}
        options={TIMER_OPTIONS.map((seconds) => ({
          label: seconds === 0 ? 'Desactivado' : formatTtl(seconds),
          selected: seconds === timer,
          onPress: () => {
            if (seconds !== timer) client.setTimer(peer, seconds);
          },
        }))}
        styles={styles}
        onClose={() => setTimerMenu(false)}
      />
    </>
  );
}
