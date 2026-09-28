import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
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

function VoicePlayerView({ uri, duration, textColor, onLongPress }: { uri: string; duration: number | null; textColor: string; onLongPress?: () => void }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const togglePlay = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
      player.seekTo(0);
    }
    player.play();
  };

  const mins = Math.floor((duration || 0) / 60);
  const secs = (duration || 0) % 60;
  const label = mins + ':' + secs.toString().padStart(2, '0');

  return (
    <TouchableOpacity onPress={togglePlay} onLongPress={onLongPress} delayLongPress={300} style={{ flexDirection: 'row', alignItems: 'center', minWidth: 130 }} activeOpacity={0.7}>
      <Text style={{ fontSize: 20, marginRight: 8 }}>{status.playing ? '⏸' : '▶️'}</Text>
      <Text style={{ color: textColor, fontSize: 14, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function EncryptedVoice(props: MediaProps & { textColor: string }) {
  const { uri, error } = useDecryptedUri(props.message, props.epoch);
  if (!uri) return <Placeholder {...props} error={error} />;
  return <VoicePlayerView key={uri} uri={uri} duration={props.message.duration} textColor={props.textColor} onLongPress={props.onLongPress} />;
}
