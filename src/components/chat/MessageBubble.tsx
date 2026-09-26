import { Text, TouchableOpacity, View } from 'react-native';
import { ChatMessage } from '../../lib/types';
import { LinkableText } from './LinkableText';
import { EncryptedImage, EncryptedVideo, EncryptedVoice } from './MediaViews';
import { ChatStyles } from './useChatTheme';

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function describeMessage(m: ChatMessage | null): string {
  if (!m) return 'Mensaje no disponible';
  if (m.deleted) return 'Mensaje eliminado';
  switch (m.kind) {
    case 'image':
      return '📷 Foto';
    case 'video':
      return '🎬 Video';
    case 'voice':
      return '🎤 Nota de voz';
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
  onZoom: (uri: string) => void;
  onRetrySend: (id: string) => void;
  onRetryDownload: (id: string) => void;
};

export function MessageBubble({ message: item, quoted, me, peer, epoch, styles, onLongPress, onZoom, onRetrySend, onRetryDownload }: Props) {
  if (item.kind === 'system') {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>🔒 {item.body}</Text>
      </View>
    );
  }

  const mine = item.fromMe;
  const isMedia = !item.deleted && (item.kind === 'image' || item.kind === 'video');
  const reactions = Object.values(item.reactions);
  const mediaProps = { message: item, epoch, styles, onRetryDownload };

  let content;
  if (item.deleted) {
    content = <Text style={styles.deletedText}>🚫 Mensaje eliminado</Text>;
  } else if (item.kind === 'image') {
    content = <EncryptedImage {...mediaProps} onZoom={onZoom} />;
  } else if (item.kind === 'video') {
    content = <EncryptedVideo {...mediaProps} />;
  } else if (item.kind === 'voice') {
    content = <EncryptedVoice {...mediaProps} textColor={mine ? styles.myText.color : styles.theirText.color} />;
  } else {
    content = <LinkableText text={item.body} textStyle={mine ? styles.myText : styles.theirText} linkStyle={mine ? styles.myLinkText : styles.theirLinkText} />;
  }

  const quote = item.replyTo ? (
    <View style={styles.quoteBox}>
      <Text style={styles.quoteName}>{quoted ? (quoted.fromMe ? me : peer).toUpperCase() : ''}</Text>
      <Text style={mine ? styles.quoteTextMine : styles.quoteText} numberOfLines={2}>{describeMessage(quoted)}</Text>
    </View>
  ) : null;

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: 3 }}>
      <TouchableOpacity activeOpacity={0.85} onLongPress={() => onLongPress(item)} delayLongPress={300}>
        {item.kind === 'sticker' && !item.deleted && !quote ? (
          <Text style={styles.stickerText}>{item.body}</Text>
        ) : (
          <View style={[styles.bubble, mine ? styles.myBubble : styles.theirBubble, isMedia && !quote && styles.imageBubble]}>
            {quote}
            {item.kind === 'sticker' && !item.deleted ? <Text style={{ fontSize: 40 }}>{item.body}</Text> : content}
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
