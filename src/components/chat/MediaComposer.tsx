// Vista previa antes de mandar fotos, videos o un documento, con una caja para escribir un comentario (como WhatsApp).
import { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { documentIcon, documentType, formatBytes } from '../../lib/documents';
import { Colors } from './theme';

export type PendingItem =
  | { kind: 'image' | 'video'; uri: string; width?: number }
  | { kind: 'file'; uri: string; name: string; mime?: string | null; size?: number };

export function MediaComposer({ items, peer, colors, initialCaption, onSend, onCancel }: {
  items: PendingItem[] | null;
  peer: string;
  colors: Colors;
  initialCaption?: string;
  onSend: (caption: string) => void;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState('');
  const [selected, setSelected] = useState(0);
  // Un doble toque en enviar no debe mandar todo dos veces
  const sentRef = useRef(false);

  useEffect(() => {
    setCaption(initialCaption ?? '');
    setSelected(0);
    sentRef.current = false;
  }, [items, initialCaption]);

  if (!items || items.length === 0) return null;
  const current = items[Math.min(selected, items.length - 1)];

  const preview = (item: PendingItem, big: boolean) => {
    const size = big ? undefined : 56;
    if (item.kind === 'image') {
      return <Image source={{ uri: item.uri }} style={big ? { flex: 1, width: '100%' } : { width: size, height: size, borderRadius: 8 }} resizeMode={big ? 'contain' : 'cover'} />;
    }
    if (item.kind !== 'file') {
      return (
        <View style={big ? { alignItems: 'center' } : { width: size, height: size, borderRadius: 8, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: big ? 72 : 24 }}>🎬</Text>
          {big && <Text style={{ color: '#ddd', marginTop: 8, fontSize: 15 }}>Video</Text>}
        </View>
      );
    }
    return (
      <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 72 }}>{documentIcon(item.name)}</Text>
        <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 12, textAlign: 'center' }} numberOfLines={3}>{item.name}</Text>
        <Text style={{ color: '#bbb', fontSize: 13, marginTop: 4 }}>{[documentType(item.name), formatBytes(item.size)].filter(Boolean).join(' · ')}</Text>
      </View>
    );
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 }}>
            <TouchableOpacity onPress={onCancel} hitSlop={12} activeOpacity={0.7}>
              <Text style={{ color: '#fff', fontSize: 26 }}>✕</Text>
            </TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', marginLeft: 16, flex: 1 }} numberOfLines={1}>
              Para {peer}
              {items.length > 1 ? ` · ${items.length} archivos` : ''}
            </Text>
          </View>

          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{preview(current, true)}</View>

          {items.length > 1 && (
            <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
              {items.map((item, i) => (
                <TouchableOpacity key={item.uri} onPress={() => setSelected(i)} activeOpacity={0.8} style={{ borderRadius: 10, borderWidth: 2, borderColor: i === selected ? colors.accent : 'transparent' }}>
                  {preview(item, false)}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingVertical: 8 }}>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={items.length > 1 ? 'Añade un comentario (va en el primero)…' : 'Añade un comentario…'}
              placeholderTextColor="#888"
              multiline
              style={{ flex: 1, minHeight: 46, maxHeight: 120, backgroundColor: '#1e1e22', color: '#fff', borderRadius: 23, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16 }}
            />
            <TouchableOpacity
              onPress={() => {
                if (sentRef.current) return;
                sentRef.current = true;
                onSend(caption);
              }}
              hitSlop={10}
              activeOpacity={0.8}
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}
            >
              <Text style={{ fontSize: 20, color: colors.onPrimary, fontWeight: '800' }}>➤</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
