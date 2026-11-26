import { useEffect, useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ChatMessage } from '../../lib/types';
import { Colors } from './theme';
import { ChatStyles } from './useChatTheme';

import { QUICK_REACTIONS, REACTION_GROUPS } from '../../lib/reactions';

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
  onSaveSticker: (m: ChatMessage) => void;
  pinned: boolean;
  onTogglePin: (m: ChatMessage) => void;
};

export function MessageActions({ message, me, styles, onClose, onReply, onEdit, onDeleteForEveryone, onDeleteForMe, onReact, onSaveSticker, pinned, onTogglePin }: ActionsProps) {
  const [expanded, setExpanded] = useState(false);
  const messageId = message?.id;
  useEffect(() => setExpanded(false), [messageId]);
  if (!message) return null;
  const myReaction = message.reactions[me];
  const canInteract = !message.deleted;
  const emojiButton = (emoji: string) => (
    <TouchableOpacity
      key={emoji}
      style={styles.emojiButton}
      accessibilityRole="button"
      accessibilityLabel={`Reaccionar con ${emoji}`}
      accessibilityState={{ selected: myReaction === emoji }}
      onPress={() => {
        onClose();
        onReact(message, myReaction === emoji ? null : emoji);
      }}
    >
      <Text style={[styles.emojiOption, myReaction === emoji && { opacity: 0.4 }]}>{emoji}</Text>
    </TouchableOpacity>
  );
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
        <Pressable style={[styles.modalCard, styles.messageActionsCard]}>
          <ScrollView>
            {canInteract && (
              <View>
                {/* El ＋ va junto a los 6 rapidos (como en WhatsApp): antes "Más emojis" estaba abajo y no se notaba */}
                <View style={styles.emojiRow}>
                  {QUICK_REACTIONS.map(emojiButton)}
                  <TouchableOpacity
                    style={styles.emojiButton}
                    accessibilityRole="button"
                    accessibilityLabel={expanded ? 'Ver menos emojis' : 'Más emojis'}
                    accessibilityState={{ expanded }}
                    onPress={() => setExpanded(!expanded)}
                  >
                    <View style={styles.emojiMoreCircle}>
                      <Text style={styles.emojiMoreText}>{expanded ? '−' : '＋'}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
                {expanded &&
                  REACTION_GROUPS.map((group) => (
                    <View key={group.title}>
                      <Text style={styles.emojiGroupTitle}>{group.title}</Text>
                      <View style={styles.emojiRow}>{group.emojis.map(emojiButton)}</View>
                    </View>
                  ))}
                <View style={styles.emojiDivider} />
              </View>
            )}
            {canInteract && option('↩  Responder', () => onReply(message))}
            {canInteract && message.kind === 'text' && !!message.body && option('📋  Copiar', () => copyText(message.body))}
            {canInteract && option(pinned ? '📌  Desfijar' : '📌  Fijar', () => onTogglePin(message))}
            {canInteract && message.fromMe && message.kind === 'text' && option('✎  Editar', () => onEdit(message))}
            {canInteract && !message.fromMe && message.kind === 'sticker' && message.mediaFile && option('🏷  Guardar en mis stickers', () => onSaveSticker(message))}
            {message.fromMe && !message.deleted && option('🗑  Borrar para todos', () => onDeleteForEveryone(message), true)}
            {option('🗑  Borrar para mí', () => onDeleteForMe(message), true)}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type Option = { label: string; selected?: boolean; onPress: () => void };

export function OptionsModal({ visible, title, message, options, styles, onClose, plain }: {
  visible: boolean;
  plain?: boolean; // sin los circulos de seleccion (para menus de acciones)
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
              <Text style={styles.modalOptionText}>{plain ? '' : o.selected ? '●  ' : '○  '}{o.label}</Text>
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
