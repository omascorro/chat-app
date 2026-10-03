import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { preparePlayback } from '../../lib/audioMode';
import { decryptToCache } from '../../lib/media';
import { ChatMessage, MediaKind } from '../../lib/types';
import { ChatStyles } from './useChatTheme';

// Descifra el archivo a la carpeta temporal cuando se va a mostrar. `epoch` cambia cuando esa carpeta se borra.
function useDecryptedUri(message: ChatMessage, epoch: number) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setUri(null);
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

function Placeholder({ message, styles, onRetryDownload, onLongPress, error }: MediaProps & { error: boolean }) {
  const textStyle = message.fromMe ? styles.mediaPlaceholderTextMine : styles.mediaPlaceholderText;
  if (message.downloadState === 'failed' || error) {
    return (
      <TouchableOpacity style={styles.mediaPlaceholder} onPress={() => onRetryDownload(message.id)} onLongPress={onLongPress} delayLongPress={300} activeOpacity={0.7}>
        <Text style={textStyle}>⚠ No se pudo descargar{'\n'}Toca para reintentar</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.mediaPlaceholder}>
      <Text style={textStyle}>{message.downloadState === 'pending' ? 'Descargando y descifrando…' : 'Descifrando…'}</Text>
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

export function EncryptedImage(props: MediaProps & { onZoom: (uri: string) => void }) {
  const { uri, error } = useDecryptedUri(props.message, props.epoch);
  if (!uri) return <Placeholder {...props} error={error} />;
  return (
    <TouchableOpacity onPress={() => props.onZoom(uri)} onLongPress={props.onLongPress} delayLongPress={300} activeOpacity={0.9}>
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
  });
  return <VideoView player={player} style={style} nativeControls contentFit="cover" />;
}

export function EncryptedVideo(props: MediaProps) {
  const { uri, error } = useDecryptedUri(props.message, props.epoch);
  if (!uri) return <Placeholder {...props} error={error} />;
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

function VoicePlayerView({ uri, seed, duration, textColor, onLongPress }: { uri: string; seed: string; duration: number | null; textColor: string; onLongPress?: () => void }) {
  // Actualizacion frecuente para que la linea avance suave
  const player = useAudioPlayer(uri, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const bars = useMemo(() => waveform(seed), [seed]);
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

export function EncryptedVoice(props: MediaProps & { textColor: string }) {
  const { uri, error } = useDecryptedUri(props.message, props.epoch);
  if (!uri) return <Placeholder {...props} error={error} />;
  return <VoicePlayerView key={uri} uri={uri} seed={props.message.id} duration={props.message.duration} textColor={props.textColor} onLongPress={props.onLongPress} />;
}
