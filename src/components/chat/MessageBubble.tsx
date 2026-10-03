import { Text, TouchableOpacity, View } from 'react-native';
import { ChatMessage } from '../../lib/types';
import { LinkableText } from './LinkableText';
import { EncryptedImage, EncryptedSticker, EncryptedVideo, EncryptedVoice, QuoteThumb } from './MediaViews';
import { ChatStyles } from './useChatTheme';

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function describeMessage(m: ChatMessage | null): string {
  if (!m) return 'Mensaje no disponible';
  if (m.deleted) return 'Mensaje eliminado';
  if (m.viewOnce) return '📷 Foto de ver una vez';
  if (m.kind === 'sticker' && m.media) return '🏷 Sticker';
  switch (m.kind) {
    case 'image':
      return '📷 Foto';
    case 'video':
      return '🎬 Video';
    case 'voice':
      return m.duration ? `🎤 Nota de voz (${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')})` : '🎤 Nota de voz';
    default:
      return m.body.length > 80 ? m.body.slice(0, 80) + '…' : m.body;
  }
}

type Props = {
  message: ChatMessage;
  quoted: ChatMessage | null;
  me: string;
  peer: string;
  epoch: number;
  styles: ChatStyles;
  onLongPress: (m: ChatMessage) => void;
  onZoom: (uri: string, messageId: string) => void;
  onRetrySend: (id: string) => void;
  onRetryDownload: (id: string) => void;
  onOpenViewOnce: (m: ChatMessage) => void;
  highlighted?: boolean; // al saltar a este mensaje (busqueda o fijado)
  onQuotePress?: (id: string) => void; // tocar la cita lleva al mensaje original
  pinned?: boolean;
};

function ViewOnceContent({ item, styles, onOpen, onRetryDownload, onLongPress }: { item: ChatMessage; styles: ChatStyles; onOpen: (m: ChatMessage) => void; onRetryDownload: (id: string) => void; onLongPress: () => void }) {
  const textStyle = item.fromMe ? styles.myText : styles.theirText;
  if (item.viewed) return <Text style={textStyle}>📷 Foto de ver una vez · {item.fromMe ? 'abierta' : 'ya la viste'}</Text>;
  if (item.fromMe) return <Text style={textStyle}>📷 Foto de ver una vez</Text>;
  if (item.downloadState === 'failed') {
    return (
      <TouchableOpacity onPress={() => onRetryDownload(item.id)} onLongPress={onLongPress} delayLongPress={300}>
        <Text style={textStyle}>📷 Foto de ver una vez{'\n'}⚠ No se pudo descargar · toca para reintentar</Text>
      </TouchableOpacity>
    );
  }
  if (item.downloadState !== 'done') return <Text style={textStyle}>📷 Foto de ver una vez · descargando…</Text>;
  return (
    <TouchableOpacity onPress={() => onOpen(item)} onLongPress={onLongPress} delayLongPress={300} activeOpacity={0.7}>
      <Text style={textStyle}>📷 Foto de ver una vez{'\n'}Toca para abrir. Se borra al cerrarla.</Text>
    </TouchableOpacity>
  );
}

export function MessageBubble({ message: item, quoted, me, peer, epoch, styles, onLongPress, onZoom, onRetrySend, onRetryDownload, onOpenViewOnce, highlighted, pinned, onQuotePress }: Props) {
  if (item.kind === 'system') {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>🔒 {item.body}</Text>
      </View>
    );
  }

  const mine = item.fromMe;
  const isMedia = !item.deleted && !item.viewOnce && (item.kind === 'image' || item.kind === 'video');
  // Los stickers nuevos son imagenes; los viejos eran un emoji en el texto
  const isImageSticker = item.kind === 'sticker' && !item.deleted && !!item.media;
  const reactions = Object.values(item.reactions);
  const mediaProps = { message: item, epoch, styles, onRetryDownload, onLongPress: () => onLongPress(item) };

  let content;
  if (item.deleted) {
    content = <Text style={styles.deletedText}>🚫 Mensaje eliminado</Text>;
  } else if (item.viewOnce) {
    content = <ViewOnceContent item={item} styles={styles} onOpen={onOpenViewOnce} onRetryDownload={onRetryDownload} onLongPress={() => onLongPress(item)} />;
  } else if (item.kind === 'image') {
    content = <EncryptedImage {...mediaProps} onZoom={onZoom} />;
  } else if (item.kind === 'video') {
    content = <EncryptedVideo {...mediaProps} />;
  } else if (item.kind === 'voice') {
    content = <EncryptedVoice {...mediaProps} textColor={mine ? styles.myText.color : styles.theirText.color} />;
  } else {
    content = <LinkableText text={item.body} textStyle={mine ? styles.myText : styles.theirText} linkStyle={mine ? styles.myLinkText : styles.theirLinkText} />;
  }

  const replyId = item.replyTo;
  const quote = replyId ? (
    <TouchableOpacity
      style={[styles.quoteBox, { flexDirection: 'row', alignItems: 'center' }]}
      onPress={() => onQuotePress?.(replyId)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={300}
      activeOpacity={0.6}
    >
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.quoteName}>{quoted ? (quoted.fromMe ? me : peer).toUpperCase() : ''}</Text>
        <Text style={mine ? styles.quoteTextMine : styles.quoteText} numberOfLines={2}>{describeMessage(quoted)}</Text>
      </View>
      {quoted && <QuoteThumb message={quoted} epoch={epoch} />}
    </TouchableOpacity>
  ) : null;

  return (
    <View style={[{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: 3, borderRadius: 16 }, highlighted && styles.highlightedRow]}>
      <TouchableOpacity activeOpacity={0.85} onLongPress={() => onLongPress(item)} delayLongPress={300}>
        {isImageSticker && !quote ? (
          <EncryptedSticker {...mediaProps} />
        ) : item.kind === 'sticker' && !item.deleted && !quote ? (
          <Text style={styles.stickerText}>{item.body}</Text>
        ) : (
          <View style={[styles.bubble, mine ? styles.myBubble : styles.theirBubble, isMedia && !quote && styles.imageBubble]}>
            {quote}
            {isImageSticker ? (
              <EncryptedSticker {...mediaProps} size={110} />
            ) : item.kind === 'sticker' && !item.deleted ? (
              <Text style={{ fontSize: 40 }}>{item.body}</Text>
            ) : (
              content
            )}
          </View>
        )}
      </TouchableOpacity>
      {reactions.length > 0 && (
        <View style={styles.reactionsRow}>
          {reactions.map((emoji, i) => (
            <View key={i} style={styles.reactionChip}>
              <Text style={styles.reactionText}>{emoji}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {pinned && <Text style={styles.timestamp}>📌 </Text>}
        {item.selfDestruct && <Text style={styles.timestamp}>⏱ </Text>}
        {item.editedAt && !item.deleted && <Text style={styles.editedLabel}>editado · </Text>}
        <Text style={styles.timestamp}>{formatTime(item.sentAt)}</Text>
        {mine && item.status === 'failed' && (
          <TouchableOpacity onPress={() => onRetrySend(item.id)} activeOpacity={0.7}>
            <Text style={styles.checkmarkFailed}>⚠ NO ENVIADO · REINTENTAR</Text>
          </TouchableOpacity>
        )}
        {mine && item.status === 'pending' && <Text style={styles.checkmark}>🕓</Text>}
        {mine && (item.status === 'sent' || item.status === 'read') && (
          <Text style={[styles.checkmark, item.status === 'read' && styles.checkmarkRead]}>{item.status === 'read' ? '✓✓' : '✓'}</Text>
        )}
      </View>
    </View>
  );
}
