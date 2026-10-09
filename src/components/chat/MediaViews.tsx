import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Image, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { preparePlayback } from '../../lib/audioMode';
import { decryptToCache, deleteFile, isInUse, keepWhilePlaying } from '../../lib/media';
import { ChatMessage, MediaKind } from '../../lib/types';
import { ChatStyles } from './useChatTheme';

// Descifra el archivo a la carpeta temporal cuando se va a mostrar. `epoch` cambia cuando esa carpeta se borra.
// keepUri: las notas de voz no sueltan su archivo cuando cambia epoch (al volver a la app); si no, el reproductor se
// recreaba y el audio que seguia sonando en segundo plano se cortaba.
function useDecryptedUri(message: ChatMessage, epoch: number, keepUri = false) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!keepUri) setUri(null);
    setError(false);
    if (!message.mediaFile || !message.media || message.downloadState !== 'done') return;
    // Los stickers son imagenes (PNG)
    const kind = (message.kind === 'sticker' ? 'image' : message.kind) as MediaKind;
    decryptToCache(message.id, kind, message.mediaFile, message.media)
      .then((u) => !cancelled && setUri(u))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
    // media se compara por su llave: cada recarga de la BD crea un objeto nuevo con el mismo contenido
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, message.mediaFile, message.media?.key, message.downloadState, message.kind, epoch]);
  return { uri, error };
}

type MediaProps = {
  message: ChatMessage;
  epoch: number;
  styles: ChatStyles;
  onRetryDownload: (id: string) => void;
  // Los botones internos (abrir foto, reproducir audio) tambien abren el menu al mantener presionado;
  // si no, se quedaban con el toque y el menu del mensaje nunca aparecia
  onLongPress?: () => void;
};

// Mismo tamaño que lo que va a aparecer (foto/video 220x220, audio una linea): si cambiara al terminar de descifrar,
// la lista se reacomodaba mientras haces scroll y parecia moverse sola
function placeholderStyle(message: ChatMessage, styles: ChatStyles) {
  if (message.kind === 'voice') return { width: 230, height: 46, alignItems: 'center' as const, justifyContent: 'center' as const };
  return [styles.mediaPlaceholder, { height: styles.messageImage.height }];
}

function Placeholder({ message, styles, onRetryDownload, onLongPress, error }: MediaProps & { error: boolean }) {
  const textStyle = message.fromMe ? styles.mediaPlaceholderTextMine : styles.mediaPlaceholderText;
  if (message.downloadState === 'failed' || error) {
    return (
      <TouchableOpacity style={placeholderStyle(message, styles)} onPress={() => onRetryDownload(message.id)} onLongPress={onLongPress} delayLongPress={300} activeOpacity={0.7}>
        <Text style={textStyle}>⚠ No se pudo descargar{'\n'}Toca para reintentar</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={placeholderStyle(message, styles)}>
      <Text style={textStyle}>{message.downloadState === 'pending' ? 'Descargando…' : 'Descifrando…'}</Text>
    </View>
  );
}

// Miniatura del mensaje citado en una respuesta (como WhatsApp). Las fotos de "ver una vez" nunca se muestran.
export function QuoteThumb({ message, epoch, size = 44 }: { message: ChatMessage; epoch: number; size?: number }) {
  const showImage = !message.deleted && !message.viewOnce && (message.kind === 'image' || (message.kind === 'sticker' && !!message.media));
  const { uri } = useDecryptedUri(showImage ? message : { ...message, downloadState: 'none' }, epoch);
  if (!message.deleted && !message.viewOnce && message.kind === 'video') {
    return (
      <View style={{ width: size, height: size, borderRadius: 8, marginLeft: 8, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: size * 0.45 }}>🎬</Text>
      </View>
    );
  }
  if (!showImage || !uri) return null;
  return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 8, marginLeft: 8 }} resizeMode={message.kind === 'sticker' ? 'contain' : 'cover'} />;
}

export function EncryptedImage(props: MediaProps & { onZoom: (uri: string, messageId: string) => void }) {
  const { uri, error } = useDecryptedUri(props.message, props.epoch);
  if (!uri) return <Placeholder {...props} error={error} />;
  return (
    <TouchableOpacity onPress={() => props.onZoom(uri, props.message.id)} onLongPress={props.onLongPress} delayLongPress={300} activeOpacity={0.9}>
      <Image source={{ uri }} style={props.styles.messageImage} resizeMode="cover" />
    </TouchableOpacity>
  );
}

// Sticker: imagen grande, sin burbuja y sin recortar (respeta la transparencia)
export function EncryptedSticker(props: MediaProps & { size?: number }) {
  const { uri, error } = useDecryptedUri(props.message, props.epoch);
  const size = props.size ?? 150;
  if (!uri) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {props.message.downloadState === 'failed' || error ? (
          <TouchableOpacity onPress={() => props.onRetryDownload(props.message.id)} onLongPress={props.onLongPress} delayLongPress={300}>
            <Text style={props.styles.mediaPlaceholderText}>⚠ Toca para reintentar</Text>
          </TouchableOpacity>
        ) : (
          <Text style={props.styles.mediaPlaceholderText}>…</Text>
        )}
      </View>
    );
  }
  return <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="contain" />;
}

function VideoPlayerView({ uri, style }: { uri: string; style: any }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={style} nativeControls contentFit="cover" />;
}

// Archivo descifrado solo cuando lo pides (al tocar). Crear un reproductor y descifrar por cada video o audio que
// aparecia en pantalla trababa el scroll; ahora mientras subes solo se dibuja un recuadro.
function useDecryptOnDemand(message: ChatMessage, epoch: number) {
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // Al salir de la app se borra lo descifrado (salvo un audio que siga sonando): hay que volver a pedirlo
  useEffect(() => {
    setUri((prev) => (prev && isInUse(prev) ? prev : null));
  }, [epoch]);
  const kind = (message.kind === 'sticker' ? 'image' : message.kind) as MediaKind;
  const open = async () => {
    if (!message.mediaFile || !message.media || busy) return;
    setBusy(true);
    setError(false);
    try {
      setUri(await decryptToCache(message.id, kind, message.mediaFile, message.media));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return { uri, busy, error, open };
}

export function EncryptedVideo(props: MediaProps) {
  const { uri, busy, error, open } = useDecryptOnDemand(props.message, props.epoch);
  if (props.message.downloadState !== 'done' || !props.message.mediaFile || error) return <Placeholder {...props} error={error} />;
  if (!uri) {
    const textColor = props.message.fromMe ? props.styles.mediaPlaceholderTextMine.color : props.styles.mediaPlaceholderText.color;
    return (
      <TouchableOpacity
        style={[props.styles.messageImage, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }]}
        onPress={open}
        onLongPress={props.onLongPress}
        delayLongPress={300}
        activeOpacity={0.8}
      >
        <Text style={{ fontSize: 44, color: '#fff' }}>{busy ? '…' : '▶'}</Text>
        <Text style={{ color: textColor, fontSize: 12, fontWeight: '700', marginTop: 6 }}>🎬 Video</Text>
      </TouchableOpacity>
    );
  }
  return <VideoPlayerView key={uri} uri={uri} style={props.styles.messageImage} />;
}

const BAR_COUNT = 30;

// Forma de onda decorativa (como WhatsApp): siempre la misma para cada nota, a partir de su id
function waveform(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ i;
    const r = ((h >>> 0) % 1000) / 1000;
    // Mas alto en medio, para que parezca una voz
    const envelope = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / BAR_COUNT);
    bars.push(4 + Math.round(18 * envelope * (0.35 + 0.65 * r)));
  }
  return bars;
}

function formatSeconds(total: number) {
  const s = Math.max(0, Math.floor(total));
  return Math.floor(s / 60) + ':' + (s % 60).toString().padStart(2, '0');
}

function VoicePlayerView({ uri, seed, duration, textColor, onLongPress, autoPlay }: { uri: string; seed: string; duration: number | null; textColor: string; onLongPress?: () => void; autoPlay?: boolean }) {
  // Actualizacion frecuente para que la linea avance suave
  const player = useAudioPlayer(uri, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const bars = useMemo(() => waveform(seed), [seed]);

  // Mientras suena: su archivo no se borra al salir de la app, y aparecen los controles en la pantalla de bloqueo
  // (en Android eso ademas mantiene vivo el audio en segundo plano). No dice de quien es, por privacidad.
  // En curso = sonando o pausada a la mitad (se puede reanudar desde la pantalla de bloqueo)
  const ended = status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05);
  const inProgress = status.playing || (status.currentTime > 0 && !ended);
  useEffect(() => {
    keepWhilePlaying(uri, inProgress);
    try {
      if (inProgress) player.setActiveForLockScreen(true, { title: 'Nota de voz', artist: 'Aeterna' });
      else player.setActiveForLockScreen(false);
    } catch {
      // sin controles en la pantalla de bloqueo; el audio sigue igual
    }
    // Termino con la app en segundo plano: la copia descifrada no se queda en el telefono
    if (!inProgress && AppState.currentState !== 'active') deleteFile(uri);
  }, [inProgress, uri, player]);

  useEffect(() => () => keepWhilePlaying(uri, false), [uri]);

  // Se crea al tocar ▶: empieza a sonar de una vez
  useEffect(() => {
    if (!autoPlay) return;
    preparePlayback().then(() => player.play());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [width, setWidth] = useState(0);

  const total = status.duration > 0 ? status.duration : duration || 0;
  const finished = status.didJustFinish || (total > 0 && status.currentTime >= total - 0.05);
  const progress = total > 0 && !finished ? Math.min(1, status.currentTime / total) : 0;
  const started = status.playing || progress > 0;

  const togglePlay = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // Sin esto, en iPhone con el interruptor de silencio activado no se oia nada
    await preparePlayback();
    if (finished) await player.seekTo(0);
    player.play();
  };

  // Tocar la linea salta a ese punto del audio
  const seek = async (x: number) => {
    if (!width || !total) return;
    const target = Math.max(0, Math.min(1, x / width)) * total;
    await preparePlayback();
    await player.seekTo(target);
    if (!status.playing) player.play();
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', width: 230 }}>
      <TouchableOpacity onPress={togglePlay} onLongPress={onLongPress} delayLongPress={300} activeOpacity={0.7} hitSlop={8}>
        <Text style={{ fontSize: 22, marginRight: 8 }}>{status.playing ? '⏸' : '▶️'}</Text>
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Pressable
          onPress={(e) => seek(e.nativeEvent.locationX)}
          onLongPress={onLongPress}
          delayLongPress={300}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={{ height: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          {bars.map((h, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{ width: 3, height: h, borderRadius: 2, backgroundColor: textColor, opacity: (i + 0.5) / BAR_COUNT <= progress ? 1 : 0.35 }}
            />
          ))}
        </Pressable>
        <Text style={{ color: textColor, fontSize: 12, fontWeight: '700', opacity: 0.8, marginTop: 2 }}>
          {started ? formatSeconds(status.currentTime) + ' / ' + formatSeconds(total) : formatSeconds(total)}
        </Text>
      </View>
    </View>
  );
}

// Nota de voz sin reproductor: solo el dibujo (mientras no la toques no se descifra ni se crea nada)
function VoiceIdle({ seed, duration, textColor, busy, onPress, onLongPress }: { seed: string; duration: number | null; textColor: string; busy: boolean; onPress: () => void; onLongPress?: () => void }) {
  const bars = useMemo(() => waveform(seed), [seed]);
  return (
    <TouchableOpacity onPress={onPress} onLongPress={onLongPress} delayLongPress={300} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', width: 230 }}>
      <Text style={{ fontSize: 22, marginRight: 8 }}>{busy ? '⏳' : '▶️'}</Text>
      <View style={{ flex: 1 }}>
        <View style={{ height: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {bars.map((h, i) => (
            <View key={i} style={{ width: 3, height: h, borderRadius: 2, backgroundColor: textColor, opacity: 0.35 }} />
          ))}
        </View>
        <Text style={{ color: textColor, fontSize: 12, fontWeight: '700', opacity: 0.8, marginTop: 2 }}>{formatSeconds(duration || 0)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function EncryptedVoice(props: MediaProps & { textColor: string }) {
  const { uri, busy, error, open } = useDecryptOnDemand(props.message, props.epoch);
  if (props.message.downloadState !== 'done' || !props.message.mediaFile || error) return <Placeholder {...props} error={error} />;
  if (!uri) return <VoiceIdle seed={props.message.id} duration={props.message.duration} textColor={props.textColor} busy={busy} onPress={open} onLongPress={props.onLongPress} />;
  return <VoicePlayerView key={uri} uri={uri} seed={props.message.id} duration={props.message.duration} textColor={props.textColor} onLongPress={props.onLongPress} autoPlay />;
}
