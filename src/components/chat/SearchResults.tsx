import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { normalizeForSearch } from '../../lib/db';
import { ChatMessage, Contact } from '../../lib/types';
import { Avatar } from './Avatar';
import { ChatStyles } from './useChatTheme';

function formatDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

// Fragmento alrededor de la coincidencia, con la parte encontrada resaltada
function Snippet({ body, query, styles }: { body: string; query: string; styles: ChatStyles }) {
  const at = normalizeForSearch(body).indexOf(normalizeForSearch(query));
  if (at < 0) return <Text style={styles.resultBody} numberOfLines={2}>{body}</Text>;
  const len = normalizeForSearch(query).length;
  const start = Math.max(0, at - 40);
  return (
    <Text style={styles.resultBody} numberOfLines={2}>
      {start > 0 ? '…' : ''}
      {body.slice(start, at)}
      <Text style={styles.resultMatch}>{body.slice(at, at + len)}</Text>
      {body.slice(at + len)}
    </Text>
  );
}

export function SearchResults({ results, query, contacts, styles, onOpen }: {
  results: ChatMessage[];
  query: string;
  contacts: Contact[];
  styles: ChatStyles;
  onOpen: (m: ChatMessage) => void;
}) {
  const photoOf = (peer: string) => contacts.find((c) => c.username === peer)?.profilePicture ?? null;
  return (
    <FlatList
      data={results}
      keyExtractor={(m) => m.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 96 }}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>SIN RESULTADOS</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.resultCard} onPress={() => onOpen(item)} activeOpacity={0.7}>
          <Avatar name={item.peer} size={38} photoBase64={photoOf(item.peer)} round />
          <View style={{ marginLeft: 10, flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.resultName} numberOfLines={1}>{item.fromMe ? `Tú → ${item.peer}` : item.peer}</Text>
              <Text style={styles.resultDate}>{formatDate(item.sentAt)}</Text>
            </View>
            <Snippet body={item.body} query={query} styles={styles} />
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

