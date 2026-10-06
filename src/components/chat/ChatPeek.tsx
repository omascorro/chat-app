// Vista previa de un chat al mantener presionado un contacto (como WhatsApp): se ven los ultimos mensajes sin abrir
// la conversacion, asi que no se marcan como leidos ni el otro ve las palomitas azules.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { client } from '../../lib/client';
import { ChatMessage, Contact } from '../../lib/types';
import { Avatar } from './Avatar';
import { QuoteThumb } from './MediaViews';
import { describeMessage } from './MessageBubble';
import { Colors } from './theme';
import { ChatStyles } from './useChatTheme';

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPeek({ contact, epoch, styles, colors, onClose, onOpen }: {
  contact: Contact | null;
  epoch: number;
  styles: ChatStyles;
  colors: Colors;
  onClose: () => void;
  onOpen: (peer: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const scrolledToEnd = useRef(false);

  useEffect(() => {
    setMessages(null);
    scrolledToEnd.current = false;
    if (!contact) return;
    let cancelled = false;
    client.previewMessages(contact.username, 60).then((list) => !cancelled && setMessages(list.filter((m) => m.kind !== 'system')));
    return () => {
      cancelled = true;
    };
  }, [contact]);

  if (!contact) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { padding: 16 }]}>
        {/* El fondo va aparte (detras): si la tarjeta estuviera dentro de algo tocable, la lista no podria desplazarse */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.modalCard, { padding: 0, overflow: 'hidden', maxHeight: '80%' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card }}>
            <Avatar name={contact.username} size={40} photoBase64={contact.profilePicture} round />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.contactName} numberOfLines={1}>{contact.username}</Text>
              <Text style={styles.contactSub} numberOfLines={1}>
                {contact.unread > 0 ? `${contact.unread} sin leer · siguen sin leer` : contact.online ? 'En línea' : 'Vista previa'}
              </Text>
            </View>
          </View>

          {messages === null ? (
            <ActivityIndicator color={colors.accent} style={{ margin: 32 }} />
          ) : messages.length === 0 ? (
            <Text style={[styles.contactSub, { textAlign: 'center', margin: 32 }]}>Todavía no hay mensajes</Text>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              style={{ flexGrow: 0, flexShrink: 1 }}
              showsVerticalScrollIndicator
              contentContainerStyle={{ padding: 12 }}
              // Abre en los mas recientes una sola vez; despues no se mueve mientras subes
              onContentSizeChange={() => {
                if (scrolledToEnd.current) return;
                scrolledToEnd.current = true;
                listRef.current?.scrollToEnd({ animated: false });
              }}
              renderItem={({ item }) => {
                const mine = item.fromMe;
                const isText = (item.kind === 'text' || (item.kind === 'sticker' && !item.media)) && !item.deleted;
                return (
                  <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: 3 }}>
                    <View style={[styles.bubble, mine ? styles.myBubble : styles.theirBubble, { flexDirection: 'row', alignItems: 'center' }]}>
                      {!isText && <QuoteThumb message={item} epoch={epoch} size={36} />}
                      <Text
                        style={[mine ? styles.myText : styles.theirText, !isText && { marginLeft: 8, fontStyle: 'italic' }, { flexShrink: 1 }]}
                        numberOfLines={4}
                      >
                        {isText ? item.body : describeMessage(item)}
                      </Text>
                    </View>
                    <Text style={styles.timestamp}>{formatTime(item.sentAt)}</Text>
                  </View>
                );
              }}
            />
          )}

          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border }}>
            <TouchableOpacity style={{ flex: 1, padding: 14, alignItems: 'center' }} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.modalButtonText}>CERRAR</Text>
            </TouchableOpacity>
            <View style={{ width: 1, backgroundColor: colors.border }} />
            <TouchableOpacity style={{ flex: 1, padding: 14, alignItems: 'center' }} onPress={() => onOpen(contact.username)} activeOpacity={0.7}>
              <Text style={styles.modalButtonText}>ABRIR CHAT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
