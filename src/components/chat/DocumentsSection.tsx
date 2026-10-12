import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { client } from '../../lib/client';
import { captionOf, documentIcon, documentType, fileNameOf, formatBytes, openDocument } from '../../lib/documents';
import { ChatMessage } from '../../lib/types';
import { Colors } from './theme';
import { ChatStyles } from './useChatTheme';

const COLLAPSED = 3;

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

// Historial de documentos del chat (como "Archivos" en WhatsApp): los mas nuevos primero
export function DocumentsSection({ peer, me, reloadKey, styles, colors, onGoToMessage }: {
  peer: string;
  me: string;
  reloadKey: unknown;
  styles: ChatStyles;
  colors: Colors;
  onGoToMessage: (id: string) => void;
}) {
  const [files, setFiles] = useState<ChatMessage[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.listFiles(peer).then((list) => !cancelled && setFiles(list));
    return () => {
      cancelled = true;
    };
  }, [peer, reloadKey]);

  const open = async (m: ChatMessage) => {
    if (m.downloadState !== 'done' || !m.mediaFile) {
      Alert.alert('Todavía no está listo', m.downloadState === 'failed' ? 'No se pudo descargar. Ábrelo en el chat para reintentar.' : 'El documento se está descargando.');
      return;
    }
    setOpening(m.id);
    try {
      await openDocument(m);
    } catch (e) {
      Alert.alert('No se pudo abrir', String((e as Error)?.message ?? e));
    } finally {
      setOpening(null);
    }
  };

  const shown = files ? (expanded ? files : files.slice(0, COLLAPSED)) : [];

  return (
    <>
      <Text style={styles.infoSectionTitle}>DOCUMENTOS{files && files.length > 0 ? ` (${files.length})` : ''}</Text>
      {files === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
      ) : files.length === 0 ? (
        <Text style={styles.settingsHint}>Aquí aparecen los documentos que se manden en este chat (PDF, Word, Excel…). Para mandar uno, toca 📷 en el chat y elige "Documento".</Text>
      ) : (
        <>
          {shown.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.settingsRow, { alignItems: 'center' }]}
              onPress={() => open(m)}
              activeOpacity={0.7}
            >
              <View style={{ width: 40, height: 46, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                {opening === m.id ? <ActivityIndicator color={colors.accent} /> : <Text style={{ fontSize: 22 }}>{documentIcon(fileNameOf(m))}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsLabel} numberOfLines={2}>{fileNameOf(m)}</Text>
                {!!captionOf(m) && <Text style={[styles.settingsHint, { fontStyle: 'italic' }]} numberOfLines={2}>“{captionOf(m)}”</Text>}
                <Text style={styles.settingsHint} numberOfLines={1}>
                  {[m.fromMe ? `Enviado por ${me}` : `De ${peer}`, formatDate(m.sentAt), documentType(fileNameOf(m)), formatBytes(m.media?.bytes)].filter(Boolean).join(' · ')}
                </Text>
                <TouchableOpacity onPress={() => onGoToMessage(m.id)} hitSlop={8} activeOpacity={0.6}>
                  <Text style={[styles.settingsHint, { color: colors.accent, fontWeight: '700', marginTop: 2 }]}>Ver en el chat</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
          {files.length > COLLAPSED && (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setExpanded(!expanded)} activeOpacity={0.8}>
              <Text style={styles.secondaryButtonText}>{expanded ? 'VER MENOS' : `VER TODOS (${files.length})`}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </>
  );
}
