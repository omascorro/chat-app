import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ImageViewing from 'react-native-image-viewing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/chat/Avatar';
import { describeMessage, MessageBubble } from '../components/chat/MessageBubble';
import { QuoteThumb } from '../components/chat/MediaViews';
import { MessageActions, OptionsModal } from '../components/chat/Modals';
import { ChatStyles, useChatTheme } from '../components/chat/useChatTheme';
import { Colors } from '../components/chat/theme';
import { client, ClientState } from '../lib/client';
import { enterRecordingMode, exitRecordingMode } from '../lib/audioMode';
import { reencodeImage } from '../lib/imageSafety';
import { log } from '../lib/log';
import { decryptToCache, deleteIfAppFile, removeFromCache } from '../lib/media';
import { protectViewOnce } from '../lib/screenProtection';
import { useAppearance, wallpaperFor } from '../lib/appearance';
import { ChatWallpaper } from '../components/chat/ChatWallpaper';
import { StickerPanel } from '../components/chat/StickerPanel';
import { SwipeToReply } from '../components/chat/SwipeToReply';
import { ChatMessage, formatTtl, shortTtl, TIMER_OPTIONS } from '../lib/types';
import { ContactInfoScreen } from './ContactInfoScreen';


type RowHandlers = {
  reply: (m: ChatMessage) => void;
  swipeDelete: (m: ChatMessage) => void;
  quotePress: (id: string) => void;
  longPress: (m: ChatMessage) => void;
  zoom: (uri: string, messageId: string) => void;
  openViewOnce: (m: ChatMessage) => void;
};

type RowProps = {
  item: ChatMessage;
  quoted: ChatMessage | null;
  me: string;
  peer: string;
  epoch: number;
  styles: ChatStyles;
  colors: Colors;
  highlighted: boolean;
  uploadPercent: number | undefined;
  pinned: boolean;
  handlers: RowHandlers;
};

// Cada recarga de la base crea objetos nuevos con el mismo contenido: se comparan por valor
function sameMessage(a: ChatMessage | null, b: ChatMessage | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const key of Object.keys(a) as (keyof ChatMessage)[]) {
    if (key === 'media') {
      if (a.media?.path !== b.media?.path || a.media?.key !== b.media?.key) return false;
    } else if (key === 'reactions') {
      if (JSON.stringify(a.reactions) !== JSON.stringify(b.reactions)) return false;
    } else if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

// Una fila del chat. Solo se vuelve a dibujar si cambia SU mensaje: antes cualquier cambio (alguien escribiendo,
// en linea, un porcentaje de subida) redibujaba todo el chat y el scroll se trababa.
const ChatRow = memo(
  function ChatRow({ item, quoted, me, peer, epoch, styles, colors, highlighted, uploadPercent, pinned, handlers }: RowProps) {
    return (
      <SwipeToReply
        enabled={item.kind !== 'system' && !item.deleted}
        iconColor={colors.accent}
        deleteColor={colors.danger}
        onReply={() => handlers.reply(item)}
        onDelete={() => handlers.swipeDelete(item)}
      >
        <MessageBubble
          message={item}
          quoted={quoted}
          onQuotePress={handlers.quotePress}
          me={me}
          peer={peer}
          epoch={epoch}
          styles={styles}
          onLongPress={handlers.longPress}
          onZoom={handlers.zoom}
          onRetrySend={retrySend}
          onRetryDownload={retryDownload}
          onOpenViewOnce={handlers.openViewOnce}
          highlighted={highlighted}
          uploadPercent={uploadPercent}
          pinned={pinned}
        />
      </SwipeToReply>
    );
  },
  (a, b) =>
    sameMessage(a.item, b.item) &&
    sameMessage(a.quoted, b.quoted) &&
    a.me === b.me &&
    a.peer === b.peer &&
    a.epoch === b.epoch &&
    a.styles === b.styles &&
    a.colors === b.colors &&
    a.highlighted === b.highlighted &&
    a.uploadPercent === b.uploadPercent &&
    a.pinned === b.pinned &&
    a.handlers === b.handlers,
);

const retrySend = (id: string) => client.retrySend(id);
const retryDownload = (id: string) => client.retryDownload(id);

export function ChatScreen({ state, peer }: { state: ClientState; peer: string }) {
  const { isDark, colors, styles } = useChatTheme();
  const appearance = useAppearance();
  const contact = state.contacts.find((c) => c.username === peer);
  const peerTyping = state.typing[peer];

  const [inputText, setInputText] = useState('');
  const [showStickers, setShowStickers] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Regresar del panel de stickers al teclado (como WhatsApp)
  const backToKeyboard = (delay = 50) => {
    setShowStickers(false);
    setTimeout(() => inputRef.current?.focus(), delay);
  };

  // Responder (deslizando a la derecha o desde el menu): se abre el teclado de una vez, como WhatsApp.
  // Desde el menu se espera a que se cierre la ventana; si no, iOS no deja enfocar la caja de texto.
  const startReply = (m: ChatMessage, delay = 50) => {
    setEditing(null);
    setReplyTo(m);
    backToKeyboard(delay);
  };

  // En Android, el boton de atras cierra primero el panel de stickers
  useEffect(() => {
    if (!showStickers) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setShowStickers(false);
      return true;
    });
    return () => sub.remove();
  }, [showStickers]);
  const [timerMenu, setTimerMenu] = useState(false);
  const [viewOnceOpen, setViewOnceOpen] = useState<{ id: string; uri: string } | null>(null);
  const timer = state.timers[peer] || 0;
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
  // Visor de fotos: todas las fotos del chat en orden, para pasar de una a otra deslizando (como WhatsApp)
  const [gallery, setGallery] = useState<{ images: { uri: string }[]; index: number } | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const openGallery = async (uri: string, messageId: string) => {
    const photos = messages.filter((m) => m.kind === 'image' && !m.viewOnce && !m.deleted && m.downloadState === 'done' && m.mediaFile && m.media);
    const pos = photos.findIndex((m) => m.id === messageId);
    if (pos < 0) {
      setGalleryIndex(0);
      setGallery({ images: [{ uri }], index: 0 });
      return;
    }
    // Hasta 30 fotos de cada lado; casi todas ya estan descifradas en la carpeta temporal porque se ven en el chat
    const around = photos.slice(Math.max(0, pos - 30), pos + 31);
    const uris = await Promise.all(
      around.map((m) => (m.id === messageId ? Promise.resolve(uri) : decryptToCache(m.id, 'image', m.mediaFile!, m.media!).catch(() => null))),
    );
    const images: { uri: string }[] = [];
    let index = 0;
    uris.forEach((u, i) => {
      if (!u) return;
      if (around[i].id === messageId) index = images.length;
      images.push({ uri: u });
    });
    setGalleryIndex(index);
    setGallery({ images, index });
  };

  // Al ir a segundo plano se borra lo descifrado: el visor se cierra
  useEffect(() => {
    setGallery(null);
  }, [state.cacheEpoch]);
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
  // Mensajes citados que son mas viejos que los cargados: se buscan aparte para que la cita no diga "no disponible"
  const [olderQuoted, setOlderQuoted] = useState<Map<string, ChatMessage>>(new Map());
  useEffect(() => {
    const missing = [...new Set(messages.map((m) => m.replyTo).filter((id): id is string => !!id && !byId.has(id) && !olderQuoted.has(id)))];
    if (missing.length === 0) return;
    let cancelled = false;
    client.getMessagesByIds(peer, missing).then((found) => {
      if (cancelled || found.length === 0) return;
      setOlderQuoted((prev) => new Map([...prev, ...found.map((m) => [m.id, m] as const)]));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, byId, peer]);
  const quotedOf = (id: string | null) => (id ? byId.get(id) ?? olderQuoted.get(id) ?? null : null);

  // Tocar la cita de una respuesta lleva al mensaje original y lo resalta (como WhatsApp)
  const goToQuoted = async (id: string) => {
    if (searchOpen) {
      setSearchOpen(false);
      setSearchQuery('');
    }
    const found = await client.jumpToMessage(id);
    if (!found) Alert.alert('Mensaje no disponible', 'El mensaje original ya no está en este chat.');
  };
  const searching = searchOpen && searchQuery.trim().length > 0;
  // La lista va invertida (como WhatsApp): empieza abajo, en el ultimo mensaje, sin tener que desplazarse
  // despues de dibujarse. Por eso los datos van del mas nuevo al mas viejo.
  const listData = useMemo(() => [...(searching ? searchResults : messages)].reverse(), [searching, searchResults, messages]);

  // Saltar a un mensaje (desde la busqueda general o un fijado) y resaltarlo un momento
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // Boton flotante para bajar al ultimo mensaje (como WhatsApp). La lista esta invertida: offset 0 = lo mas nuevo.
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const awayRef = useRef(false);
  const [newWhileAway, setNewWhileAway] = useState(0);
  const newestIdRef = useRef<string | null>(null);
  const onListScroll = (y: number) => {
    const away = y > 600;
    if (away === awayRef.current) return;
    awayRef.current = away;
    setAwayFromLatest(away);
    if (!away) setNewWhileAway(0);
  };
  const scrollToLatest = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setNewWhileAway(0);
  };
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pinIndex, setPinIndex] = useState(0);
  const pinned = state.pinnedMessages;
  const pinnedIds = useMemo(() => new Set(pinned.map((m) => m.id)), [pinned]);

  useEffect(() => {
    const target = state.jumpTo;
    if (!target || searching) return;
    const index = listData.findIndex((m) => m.id === target);
    if (index < 0) return;
    client.clearJump();
    setHighlightId(target);
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }));
    // El temporizador va aparte: clearJump vuelve a correr este efecto, y si se cancelaba aqui el resaltado nunca se quitaba
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1800);
  }, [state.jumpTo, listData, searching]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  useEffect(() => {
    const newest = messages[messages.length - 1];
    if (!newest || newest.id === newestIdRef.current) return;
    const first = newestIdRef.current === null;
    newestIdRef.current = newest.id;
    if (first || !awayRef.current) return;
    if (newest.fromMe) scrollToLatest();
    else if (newest.kind !== 'system') setNewWhileAway((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const goToPinned = () => {
    if (pinned.length === 0) return;
    const current = pinned[pinIndex % pinned.length];
    client.jumpToMessage(current.id);
    // Con varios fijados, cada toque pasa al siguiente (como WhatsApp)
    setPinIndex((i) => (i + 1) % pinned.length);
  };

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

  const chooseMediaSource = () => {
    Alert.alert('Enviar foto o video', undefined, [
      { text: 'Cámara', onPress: () => pickMedia('camera') },
      { text: 'Galería', onPress: () => pickMedia('library') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const pickMedia = async (source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images', 'videos'],
      quality: 0.4,
      videoMaxDuration: 30,
      // iPhone: los videos se comprimen (antes iban en calidad original y pesaban decenas de MB). Android no lo permite.
      videoExportPreset: ImagePicker.VideoExportPreset.H264_960x540,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Sin permiso de cámara', 'Actívalo en la configuración del teléfono para tomar fotos desde la app.');
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
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
      // Las fotos SIEMPRE se vuelven a codificar: asi se eliminan los datos ocultos (EXIF) como la ubicacion GPS,
      // el modelo del telefono o la fecha. Si no se puede, la foto no se envia.
      const clean = await reencodeImage(asset.uri, asset.width);
      if (!clean) {
        deleteIfAppFile(asset.uri);
        Alert.alert('No se pudo preparar la foto', 'Por seguridad no se envió: no se pudieron quitar sus datos ocultos (como la ubicación).');
        return;
      }
      uri = clean;
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
      await enterRecordingMode();
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
      exitRecordingMode();
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
    } finally {
      // Para que las notas de voz se escuchen por la bocina y con volumen normal
      exitRecordingMode();
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
    } finally {
      // Para que las notas de voz se escuchen por la bocina y con volumen normal
      exitRecordingMode();
    }
    if (audioRecorder.uri) deleteIfAppFile(audioRecorder.uri);
  };

  const startEdit = (m: ChatMessage) => {
    setReplyTo(null);
    setEditing(m);
    setInputText(m.body);
    // Se abre el teclado para editar de una vez (se espera a que se cierre el menu, si no iOS no deja enfocar)
    backToKeyboard(350);
  };

  const confirmDeleteForEveryone = (m: ChatMessage) => {
    Alert.alert('Borrar para todos', 'El mensaje se borrará también en el teléfono de la otra persona.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => client.deleteForEveryone(peer, m.id) },
    ]);
  };

  // Al deslizar un mensaje a la izquierda
  const confirmSwipeDelete = (m: ChatMessage) => {
    const canDeleteForEveryone = m.fromMe && !m.deleted && m.kind !== 'system';
    Alert.alert(
      'Borrar mensaje',
      canDeleteForEveryone ? '"Para todos" también lo borra del teléfono de la otra persona.' : 'Se borra solo de tu teléfono.',
      [
        { text: 'Cancelar', style: 'cancel' },
        ...(canDeleteForEveryone
          ? [{ text: 'Borrar para todos', style: 'destructive' as const, onPress: () => client.deleteForEveryone(peer, m.id) }]
          : []),
        { text: 'Borrar para mí', style: 'destructive' as const, onPress: () => client.deleteForMe(m.id) },
      ],
    );
  };

  // Manejadores estables para las filas memorizadas: siempre llaman a la version mas reciente de cada funcion
  const handlersRef = useRef({ startReply, confirmSwipeDelete, goToQuoted, setActionTarget, openGallery, openViewOnce });
  handlersRef.current = { startReply, confirmSwipeDelete, goToQuoted, setActionTarget, openGallery, openViewOnce };
  const rowHandlers = useMemo<RowHandlers>(
    () => ({
      reply: (m) => handlersRef.current.startReply(m),
      swipeDelete: (m) => handlersRef.current.confirmSwipeDelete(m),
      quotePress: (id) => handlersRef.current.goToQuoted(id),
      longPress: (m) => handlersRef.current.setActionTarget(m),
      zoom: (uri, id) => handlersRef.current.openGallery(uri, id),
      openViewOnce: (m) => handlersRef.current.openViewOnce(m),
    }),
    [],
  );

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

          {pinned.length > 0 && !searchOpen && (
            <TouchableOpacity style={styles.pinBar} onPress={goToPinned} activeOpacity={0.7}>
              <Text style={{ fontSize: 16, marginRight: 8 }}>📌</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.pinBarLabel}>
                  {pinned.length > 1 ? `MENSAJE FIJADO ${(pinIndex % pinned.length) + 1} DE ${pinned.length}` : 'MENSAJE FIJADO'}
                </Text>
                <Text style={styles.pinBarText} numberOfLines={1}>{describeMessage(pinned[pinIndex % pinned.length])}</Text>
              </View>
              <TouchableOpacity
                style={styles.pinBarClose}
                onPress={() => client.setPinned(peer, pinned[pinIndex % pinned.length].id, false)}
                activeOpacity={0.6}
              >
                <Text style={{ fontSize: 16, color: colors.textMuted }}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
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
            ref={listRef}
            inverted
            onScrollToIndexFailed={(info) => {
              // El mensaje todavia no se ha dibujado: acercarse y volver a intentar
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }), 120);
            }}
            style={{ flex: 1 }}
            data={listData}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            onScroll={(e) => onListScroll(e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={100}
            initialNumToRender={15}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={40}
            windowSize={9}
            renderItem={({ item }) => (
              <ChatRow
                item={item}
                quoted={quotedOf(item.replyTo)}
                me={state.username}
                peer={peer}
                epoch={state.cacheEpoch}
                styles={styles}
                colors={colors}
                highlighted={item.id === highlightId}
                uploadPercent={state.uploadProgress[item.id]}
                pinned={pinnedIds.has(item.id)}
                handlers={rowHandlers}
              />
            )}
          />
          {awayFromLatest && !searching && (
            <TouchableOpacity
              onPress={scrollToLatest}
              activeOpacity={0.8}
              hitSlop={8}
              style={{
                position: 'absolute', right: 14, bottom: 14, width: 42, height: 42, borderRadius: 21,
                backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
                shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
              }}
            >
              <Text style={{ fontSize: 20, color: colors.text, marginTop: -2 }}>⌄</Text>
              {newWhileAway > 0 && (
                <View style={{ position: 'absolute', top: -6, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: colors.onAccent }}>{newWhileAway > 99 ? '99+' : newWhileAway}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          </ChatWallpaper>

          {(replyTo || editing) && (
            <View style={styles.replyBar}>
              <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} disabled={!replyTo || !!editing} onPress={() => replyTo && goToQuoted(replyTo.id)} activeOpacity={0.6}>
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarLabel}>{editing ? 'EDITANDO MENSAJE' : `RESPONDIENDO A ${(replyTo!.fromMe ? state.username : peer).toUpperCase()}`}</Text>
                <Text style={styles.replyBarText} numberOfLines={1}>{describeMessage(editing || replyTo)}</Text>
              </View>
              {replyTo && !editing && <QuoteThumb message={replyTo} epoch={state.cacheEpoch} size={40} />}
              </TouchableOpacity>
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
                      if (showStickers) {
                        backToKeyboard();
                        return;
                      }
                      Keyboard.dismiss();
                      setShowStickers(true);
                    }}
                    style={styles.composerIconButton}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.composerIcon}>{showStickers ? '⌨️' : '🏷'}</Text>
                  </TouchableOpacity>
                )}
                <TextInput
                  ref={inputRef}
                  style={styles.composerInput}
                  placeholder={editing ? 'Editar mensaje' : 'Mensaje'}
                  placeholderTextColor={colors.textMuted}
                  value={inputText}
                  onChangeText={onChangeText}
                  onFocus={() => setShowStickers(false)}
                  multiline
                />
                {!editing && (
                  <TouchableOpacity onPress={chooseMediaSource} style={styles.composerIconButton} activeOpacity={0.6}>
                    <Text style={styles.composerIcon}>📷</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {isRecording ? (
              <TouchableOpacity style={[styles.composerAction, styles.composerActionRecording]} onPress={stopRecordingAndSend} hitSlop={10} activeOpacity={0.8}>
                <Text style={styles.composerActionIcon}>➤</Text>
              </TouchableOpacity>
            ) : inputText.trim() !== '' || editing ? (
              <TouchableOpacity style={styles.composerAction} onPress={send} hitSlop={10} activeOpacity={0.8}>
                <Text style={styles.composerActionIcon}>{editing ? '✓' : '➤'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.composerAction} onPress={startRecording} hitSlop={10} activeOpacity={0.8}>
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
                // Al mandarlo se cierra el panel y vuelve el teclado para seguir escribiendo
                backToKeyboard();
                // Si estabas respondiendo un mensaje (por ejemplo otro sticker), el sticker va como respuesta
                const replyId = replyTo?.id ?? null;
                setReplyTo(null);
                client.sendStickerImage(peer, id, { replyTo: replyId }).catch((e) => Alert.alert('No se pudo mandar el sticker', String((e as Error)?.message ?? e)));
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
        onReply={(m) => startReply(m, 350)}
        onEdit={startEdit}
        onDeleteForEveryone={confirmDeleteForEveryone}
        onDeleteForMe={(m) => client.deleteForMe(m.id)}
        pinned={!!actionTarget && pinnedIds.has(actionTarget.id)}
        onTogglePin={(m) => client.setPinned(peer, m.id, !pinnedIds.has(m.id))}
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
      <ImageViewing
        images={gallery?.images ?? []}
        imageIndex={gallery?.index ?? 0}
        visible={!!gallery}
        onRequestClose={() => setGallery(null)}
        onImageIndexChange={setGalleryIndex}
        HeaderComponent={() => (
          <SafeAreaView edges={['top']} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
              {gallery && gallery.images.length > 1 ? `${galleryIndex + 1} / ${gallery.images.length}` : ''}
            </Text>
            <TouchableOpacity onPress={() => setGallery(null)} hitSlop={12} activeOpacity={0.7}>
              <Text style={{ color: '#fff', fontSize: 26 }}>✕</Text>
            </TouchableOpacity>
          </SafeAreaView>
        )}
      />
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
