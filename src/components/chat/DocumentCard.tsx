import { useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { documentIcon, documentType, fileNameOf, formatBytes, openDocument } from '../../lib/documents';
import { ChatMessage } from '../../lib/types';
import { ChatStyles } from './useChatTheme';

// Documento dentro de una burbuja del chat: icono, nombre, tipo y tamaño. Tocarlo lo abre con las apps del telefono.
export function DocumentCard({ message, styles, textColor, onLongPress, onRetryDownload }: {
  message: ChatMessage;
  styles: ChatStyles;
  textColor: string;
  onLongPress?: () => void;
  onRetryDownload: (id: string) => void;
}) {
  const [opening, setOpening] = useState(false);
  const name = fileNameOf(message);
  const ready = message.downloadState === 'done' && !!message.mediaFile;
  const failed = message.downloadState === 'failed';

  const onPress = async () => {
    if (failed) {
      onRetryDownload(message.id);
      return;
    }
    if (!ready || opening) return;
    setOpening(true);
    try {
      await openDocument(message);
    } catch (e) {
      Alert.alert('No se pudo abrir', String((e as Error)?.message ?? e));
    } finally {
      setOpening(false);
    }
  };

  const details = [documentType(name), formatBytes(message.media?.bytes)].filter(Boolean).join(' · ');
  const status = failed ? '⚠ No se pudo descargar · toca para reintentar' : !ready ? 'Descargando…' : 'Toca para abrir';

  return (
    <TouchableOpacity onPress={onPress} onLongPress={onLongPress} delayLongPress={300} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', width: 240 }}>
      <View style={{ width: 44, height: 50, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
        {opening ? <ActivityIndicator color={textColor} /> : <Text style={{ fontSize: 26 }}>{documentIcon(name)}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: textColor, fontSize: 14, fontWeight: '700' }} numberOfLines={2}>{name}</Text>
        {!!details && <Text style={{ color: textColor, fontSize: 11, opacity: 0.75, marginTop: 2 }}>{details}</Text>}
        <Text style={[styles.timestamp, { color: textColor, opacity: 0.7, marginHorizontal: 0 }]}>{status}</Text>
      </View>
    </TouchableOpacity>
  );
}
