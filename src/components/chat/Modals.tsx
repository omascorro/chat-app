import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ChatMessage } from '../../lib/types';
import { Colors } from './theme';
import { ChatStyles } from './useChatTheme';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

type ActionsProps = {
  message: ChatMessage | null;
  me: string;
  styles: ChatStyles;
  onClose: () => void;
  onReply: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onDeleteForEveryone: (m: ChatMessage) => void;
  onDeleteForMe: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string | null) => void;
};

export function MessageActions({ message, me, styles, onClose, onReply, onEdit, onDeleteForEveryone, onDeleteForMe, onReact }: ActionsProps) {
  if (!message) return null;
  const myReaction = message.reactions[me];
  const canInteract = !message.deleted;
  const option = (label: string, action: () => void, danger = false) => (
    <TouchableOpacity
      style={styles.modalOption}
      onPress={() => {
        onClose();
        action();
      }}
    >
      <Text style={danger ? styles.modalDangerText : styles.modalOptionText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard}>
          {canInteract && (
            <View style={styles.emojiRow}>
              {REACTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => {
                    onClose();
                    onReact(message, myReaction === emoji ? null : emoji);
                  }}
                >
                  <Text style={[styles.emojiOption, myReaction === emoji && { opacity: 0.4 }]}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {canInteract && option('↩  Responder', () => onReply(message))}
          {canInteract && message.fromMe && message.kind === 'text' && option('✎  Editar', () => onEdit(message))}
          {message.fromMe && !message.deleted && option('🗑  Borrar para todos', () => onDeleteForEveryone(message), true)}
          {option('🗑  Borrar para mí', () => onDeleteForMe(message), true)}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type Option = { label: string; selected?: boolean; onPress: () => void };

export function OptionsModal({ visible, title, message, options, styles, onClose }: {
  visible: boolean;
  title: string;
  message?: string;
  options: Option[];
  styles: ChatStyles;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          {message ? <Text style={styles.modalText}>{message}</Text> : null}
          {options.map((o) => (
            <TouchableOpacity
              key={o.label}
              style={styles.modalOption}
              onPress={() => {
                onClose();
                o.onPress();
              }}
            >
              <Text style={styles.modalOptionText}>{o.selected ? '●  ' : '○  '}{o.label}</Text>
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type PromptProps = {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  secure?: boolean;
  confirmLabel: string;
  styles: ChatStyles;
  colors: Colors;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

export function PromptModal({ visible, title, message, placeholder, secure, confirmLabel, styles, colors, onSubmit, onCancel }: PromptProps) {
  const [value, setValue] = useState('');
  useEffect(() => {
    if (visible) setValue('');
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          {message ? <Text style={styles.modalText}>{message}</Text> : null}
          <TextInput
            style={styles.input}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={secure}
            value={value}
            onChangeText={setValue}
            autoFocus
            onSubmitEditing={() => onSubmit(value)}
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.modalButton} onPress={onCancel}>
              <Text style={[styles.modalButtonText, { color: colors.textMuted }]}>CANCELAR</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalButton} onPress={() => onSubmit(value)}>
              <Text style={styles.modalButtonText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
