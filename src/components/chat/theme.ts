import { StyleSheet } from 'react-native';

export type Colors = {
  bg: string;
  card: string;
  primary: string;
  accent: string;
  text: string;
  textMuted: string;
  bubbleMine: string;
  bubbleTheirs: string;
  border: string;
  danger: string;
  onPrimary: string; // texto sobre primary y sobre danger
  onAccent: string; // texto sobre accent
  onBubbleMine: string; // texto de mis burbujas
};

export type ThemeDef = { id: string; name: string; light: Colors; dark: Colors };

// Temas de la app. Cada uno tiene version clara y oscura.
export const THEMES: ThemeDef[] = [
  {
    id: 'militar',
    name: 'Militar',
    light: {
      bg: '#EDE9DC', card: '#F7F4E9', primary: '#4B5320', accent: '#B8862E', text: '#242018', textMuted: '#7A745F',
      bubbleMine: '#4B5320', bubbleTheirs: '#DCD6C1', border: '#B9B196', danger: '#8C2F1E',
      onPrimary: '#F2F0E4', onAccent: '#1A1712', onBubbleMine: '#F2F0E4',
    },
    dark: {
      bg: '#15170F', card: '#20231A', primary: '#6B7A3A', accent: '#D4A24C', text: '#EDEAD9', textMuted: '#8C917A',
      bubbleMine: '#4B5320', bubbleTheirs: '#2B2E22', border: '#3A3E2C', danger: '#C0432E',
      onPrimary: '#F2F0E4', onAccent: '#1A1712', onBubbleMine: '#F2F0E4',
    },
  },
  {
    id: 'clasico',
    name: 'Clásico',
    light: {
      bg: '#EFE7DD', card: '#FFFFFF', primary: '#128C7E', accent: '#25D366', text: '#111B21', textMuted: '#667781',
      bubbleMine: '#D9FDD3', bubbleTheirs: '#FFFFFF', border: '#D1D7DB', danger: '#D93025',
      onPrimary: '#FFFFFF', onAccent: '#0B141A', onBubbleMine: '#111B21',
    },
    dark: {
      bg: '#0B141A', card: '#1F2C34', primary: '#00A884', accent: '#25D366', text: '#E9EDEF', textMuted: '#8696A0',
      bubbleMine: '#005C4B', bubbleTheirs: '#1F2C34', border: '#2A3942', danger: '#F15C6D',
      onPrimary: '#FFFFFF', onAccent: '#0B141A', onBubbleMine: '#E9EDEF',
    },
  },
  {
    id: 'oceano',
    name: 'Océano',
    light: {
      bg: '#E8F1F5', card: '#F7FBFD', primary: '#1F5F7A', accent: '#2A9D8F', text: '#0F2530', textMuted: '#5B7682',
      bubbleMine: '#1F5F7A', bubbleTheirs: '#D6E6EE', border: '#B5CBD6', danger: '#B23A48',
      onPrimary: '#FFFFFF', onAccent: '#FFFFFF', onBubbleMine: '#FFFFFF',
    },
    dark: {
      bg: '#0B1A21', card: '#13262F', primary: '#2C7DA0', accent: '#48C9B0', text: '#E3F1F6', textMuted: '#7FA0AD',
      bubbleMine: '#1F5F7A', bubbleTheirs: '#1B323D', border: '#29424E', danger: '#E05D6F',
      onPrimary: '#FFFFFF', onAccent: '#0B1A21', onBubbleMine: '#FFFFFF',
    },
  },
  {
    id: 'grafito',
    name: 'Grafito',
    light: {
      bg: '#EFEFF1', card: '#FFFFFF', primary: '#3A3A40', accent: '#6C63FF', text: '#16161A', textMuted: '#6E6E78',
      bubbleMine: '#3A3A40', bubbleTheirs: '#E2E2E8', border: '#CFCFD6', danger: '#C0392B',
      onPrimary: '#FFFFFF', onAccent: '#FFFFFF', onBubbleMine: '#FFFFFF',
    },
    dark: {
      bg: '#111113', card: '#1C1C20', primary: '#4A4A55', accent: '#8B84FF', text: '#ECECF1', textMuted: '#8E8E99',
      bubbleMine: '#3F3D63', bubbleTheirs: '#26262C', border: '#33333B', danger: '#E5534B',
      onPrimary: '#FFFFFF', onAccent: '#111113', onBubbleMine: '#FFFFFF',
    },
  },
  {
    id: 'rosa',
    name: 'Rosa',
    light: {
      bg: '#FBEFF3', card: '#FFF8FA', primary: '#B0476B', accent: '#D98E04', text: '#2B141D', textMuted: '#8C6673',
      bubbleMine: '#B0476B', bubbleTheirs: '#F2DCE4', border: '#E5C3CF', danger: '#A3222F',
      onPrimary: '#FFFFFF', onAccent: '#FFFFFF', onBubbleMine: '#FFFFFF',
    },
    dark: {
      bg: '#1C0F14', card: '#2A1720', primary: '#C2587D', accent: '#F0A83A', text: '#F7E6EC', textMuted: '#B28D9A',
      bubbleMine: '#8E3657', bubbleTheirs: '#36202A', border: '#4A2C39', danger: '#E5606E',
      onPrimary: '#FFFFFF', onAccent: '#1C0F14', onBubbleMine: '#FFFFFF',
    },
  },
];

export const DEFAULT_THEME_ID = 'militar';

export function getTheme(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// Compatibilidad con el codigo que usaba la paleta fija
export const LIGHT_COLORS = THEMES[0].light;
export const DARK_COLORS = THEMES[0].dark;

export function createStyles(COLORS: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.bg },
    authWrapper: { flex: 1, backgroundColor: COLORS.primary },
    authCard: {
      flex: 1,
      backgroundColor: COLORS.bg,
      marginTop: 90,
      paddingHorizontal: 26,
      paddingTop: 32,
      alignItems: 'center',
      borderTopWidth: 3,
      borderTopColor: COLORS.accent,
    },
    logoBadge: {
      width: 66, height: 66, borderRadius: 10,
      backgroundColor: COLORS.primary,
      alignItems: 'center', justifyContent: 'center',
      marginTop: -70,
      marginBottom: 14,
      borderWidth: 2,
      borderColor: COLORS.accent,
    },
    logoText: { fontSize: 30 },
    appName: { fontSize: 22, fontWeight: '800', color: COLORS.text, letterSpacing: 3 },
    appNameUnderline: { width: 40, height: 3, backgroundColor: COLORS.accent, marginTop: 8, marginBottom: 12 },
    appTagline: { fontSize: 12, color: COLORS.textMuted, marginBottom: 20, textAlign: 'center', lineHeight: 17, fontStyle: 'italic' },
    connectionPill: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: COLORS.card, borderRadius: 3,
      paddingHorizontal: 12, paddingVertical: 6, marginBottom: 22,
      borderWidth: 1, borderColor: COLORS.border,
    },
    dot: { width: 7, height: 7, borderRadius: 4, marginRight: 7 },
    connectionText: { fontSize: 10, color: COLORS.textMuted, letterSpacing: 1, fontWeight: '700' },
    formTitle: { fontSize: 13, fontWeight: '800', color: COLORS.accent, alignSelf: 'flex-start', marginBottom: 16, letterSpacing: 1.5 },
    inputLabel: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted, alignSelf: 'flex-start', letterSpacing: 1, marginBottom: 4 },
    input: {
      width: '100%', backgroundColor: COLORS.card,
      borderRadius: 14, padding: 12, fontSize: 15, color: COLORS.text,
      marginBottom: 14, borderWidth: 1, borderColor: COLORS.border,
    },
    errorText: { color: COLORS.danger, fontSize: 12, marginBottom: 10, alignSelf: 'flex-start', fontWeight: '600' },
    primaryButton: {
      width: '100%', backgroundColor: COLORS.accent,
      borderRadius: 24, paddingVertical: 14, alignItems: 'center', marginTop: 6,
    },
    primaryButtonText: { color: COLORS.onAccent, fontWeight: '800', fontSize: 14, letterSpacing: 1.5 },
    switchText: { color: COLORS.textMuted, marginTop: 18, fontSize: 11, letterSpacing: 0.5 },
    switchTextBold: { color: COLORS.accent, fontWeight: '800' },
    recoveryCodeBox: {
      width: '100%', backgroundColor: COLORS.card, borderWidth: 2, borderColor: COLORS.accent,
      borderRadius: 3, paddingVertical: 20, alignItems: 'center', marginBottom: 24,
    },
    recoveryCodeText: { fontSize: 26, fontWeight: '800', color: COLORS.accent, letterSpacing: 4 },
    header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, backgroundColor: COLORS.card, borderBottomWidth: 2, borderBottomColor: COLORS.primary },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    headerTitle: { fontSize: 15, fontWeight: '800', color: COLORS.text, letterSpacing: 1 },
    headerSubtitle: { fontSize: 10, color: COLORS.textMuted, marginTop: 2, fontWeight: '600', letterSpacing: 0.5 },
    logoutButton: {
      borderWidth: 1, borderColor: COLORS.border, borderRadius: 2,
      paddingHorizontal: 10, paddingVertical: 6,
    },
    logoutButtonText: { fontSize: 10, fontWeight: '800', color: COLORS.danger, letterSpacing: 1 },
    selfDestructActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
    sectionDivider: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
    sectionTitle: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1.5 },
    userRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: COLORS.card, borderRadius: 3,
      padding: 12, marginBottom: 8,
      borderWidth: 1, borderColor: COLORS.border,
      borderLeftWidth: 3, borderLeftColor: COLORS.primary,
    },
    userName: { fontSize: 13, fontWeight: '700', color: COLORS.text, letterSpacing: 0.5 },
    userStatus: { fontSize: 10, color: COLORS.textMuted, marginTop: 2, fontWeight: '600', letterSpacing: 0.5 },
    chevron: { fontSize: 22, color: COLORS.textMuted },
    statusDot: {
      position: 'absolute', bottom: -2, right: -2,
      width: 12, height: 12, borderRadius: 3,
      borderWidth: 2, borderColor: COLORS.bg,
    },
    emptyState: { alignItems: 'center', marginTop: 60 },
    emptyEmoji: { fontSize: 32, marginBottom: 8 },
    emptyText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    chatHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: COLORS.bg, borderBottomWidth: 1, borderBottomColor: COLORS.border,
    },
    backTouchable: { paddingRight: 6, paddingVertical: 4 },
    backChevron: { fontSize: 30, color: COLORS.accent, fontWeight: '300' },
    chatHeaderName: { fontSize: 14, fontWeight: '800', color: COLORS.text, letterSpacing: 0.5 },
    chatHeaderSub: { fontSize: 10, color: COLORS.textMuted, marginTop: 1, fontWeight: '600', letterSpacing: 0.3 },
    messageList: { padding: 14, paddingBottom: 10 },
    bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
    imageBubble: { padding: 4, overflow: 'hidden' },
    messageImage: { width: 220, height: 220, borderRadius: 14 },
    myBubble: { backgroundColor: COLORS.bubbleMine, borderTopRightRadius: 5 },
    theirBubble: { backgroundColor: COLORS.bubbleTheirs, borderTopLeftRadius: 5, borderWidth: 1, borderColor: COLORS.border },
    myText: { color: COLORS.onBubbleMine, fontSize: 15, lineHeight: 20 },
    theirText: { color: COLORS.text, fontSize: 15, lineHeight: 20 },
    myLinkText: { color: COLORS.onBubbleMine, fontSize: 15, lineHeight: 20, textDecorationLine: 'underline', fontWeight: '700' },
    theirLinkText: { color: COLORS.accent, fontSize: 15, lineHeight: 20, textDecorationLine: 'underline', fontWeight: '700' },
    timestamp: { fontSize: 9, color: COLORS.textMuted, marginTop: 3, marginHorizontal: 4, fontWeight: '600' },
    checkmark: { fontSize: 10, color: COLORS.textMuted, marginTop: 3, fontWeight: '700' },
    checkmarkRead: { color: COLORS.accent },
    checkmarkFailed: { fontSize: 10, color: COLORS.danger, marginTop: 3, marginLeft: 6, fontWeight: '800' },
    inputRow: {
      flexDirection: 'row', alignItems: 'flex-end',
      paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: COLORS.card, borderTopWidth: 2, borderTopColor: COLORS.primary,
    },
    messageInput: {
      flex: 1, backgroundColor: COLORS.bg,
      borderRadius: 2, paddingHorizontal: 14, paddingVertical: 10,
      fontSize: 15, color: COLORS.text, maxHeight: 100, marginRight: 8,
      borderWidth: 1, borderColor: COLORS.border,
    },
    sendButton: {
      width: 42, height: 42, borderRadius: 3,
      backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center',
    },
    sendButtonIcon: { color: COLORS.onAccent, fontSize: 16, fontWeight: '800' },
    attachButton: {
      width: 42, height: 42, borderRadius: 3,
      backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border,
      alignItems: 'center', justifyContent: 'center', marginRight: 8,
    },
    attachButtonIcon: { fontSize: 18 },
    attachButtonRecording: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
    recordingIndicator: {
      flex: 1, flexDirection: 'row', alignItems: 'center',
      backgroundColor: COLORS.bg, borderRadius: 2,
      paddingHorizontal: 14, paddingVertical: 10, marginRight: 8,
      borderWidth: 1, borderColor: COLORS.danger,
    },
    recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.danger, marginRight: 8 },
    recordingText: { flex: 1, color: COLORS.text, fontSize: 15, fontWeight: '600' },
    stickerText: { fontSize: 72 },
    stickerPanel: {
      height: 280, backgroundColor: COLORS.card,
      borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: COLORS.border,
    },
    stickerCell: { width: '25%', aspectRatio: 1, padding: 6 },
    stickerAddCell: {
      alignItems: 'center', justifyContent: 'center',
      borderRadius: 18, borderWidth: 2, borderStyle: 'dashed', borderColor: COLORS.border,
    },
    stickerAddText: { fontSize: 30, color: COLORS.textMuted },
    stickerOption: {
      flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
    },
    stickerOptionText: { fontSize: 30 },

    // Lista de contactos, con el mismo estilo redondeado
    contactsTitle: { fontSize: 24, fontWeight: '800', color: COLORS.text, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10 },
    contactCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: COLORS.card, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border,
      paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8,
    },
    contactOnlineDot: {
      position: 'absolute', bottom: 0, right: 0,
      width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: COLORS.card,
    },
    contactName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
    contactSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
    contactUnread: {
      minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7,
      backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 8,
    },
    contactUnreadText: { fontSize: 12, fontWeight: '800', color: COLORS.onPrimary },
    fab: {
      position: 'absolute', right: 18, bottom: 28,
      width: 58, height: 58, borderRadius: 29, backgroundColor: COLORS.primary,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5,
    },
    fabIcon: { fontSize: 28, color: COLORS.onPrimary, fontWeight: '600', marginTop: -2 },

    // Apariencia: temas y fondos
    themeCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border,
      padding: 12, marginBottom: 8,
    },
    themeCardActive: { borderColor: COLORS.accent, borderWidth: 2 },
    themeSwatches: { flexDirection: 'row', marginRight: 12 },
    themeSwatch: { width: 22, height: 22, borderRadius: 11, marginRight: -6, borderWidth: 2, borderColor: COLORS.card },
    themeName: { flex: 1, fontSize: 15, fontWeight: '700', color: COLORS.text },
    segmentRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
    segment: {
      paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, marginRight: 8, marginBottom: 8,
      backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    },
    segmentActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    segmentText: { fontSize: 13, fontWeight: '700', color: COLORS.text },
    segmentTextActive: { color: COLORS.onPrimary },
    wallpaperGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
    wallpaperSwatch: { width: 48, height: 48, borderRadius: 24, marginRight: 10, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
    wallpaperPreviewImage: { width: '100%', height: 140, borderRadius: 16 },
    previewBox: { height: 190, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },

    // Encabezado del chat, con el mismo estilo que la barra de escritura
    topRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 8, paddingTop: 6, paddingBottom: 6,
      backgroundColor: COLORS.bg,
    },
    topBox: {
      flex: 1, flexDirection: 'row', alignItems: 'center',
      height: 50, backgroundColor: COLORS.card,
      borderRadius: 25, borderWidth: 1, borderColor: COLORS.border,
      paddingRight: 14, marginRight: 6,
    },
    topBack: { width: 36, height: 48, alignItems: 'center', justifyContent: 'center' },
    topBackIcon: { fontSize: 30, color: COLORS.accent, fontWeight: '300', marginTop: -3 },
    topContact: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    topName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
    topSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
    topRoundButton: {
      width: 46, height: 46, borderRadius: 23, marginLeft: 4,
      backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
      alignItems: 'center', justifyContent: 'center',
    },
    topRoundButtonActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    topRoundIcon: { fontSize: 18 },
    topRoundTextActive: { fontSize: 14, color: COLORS.onPrimary, fontWeight: '800' },
    topSearchRow: { paddingHorizontal: 8, paddingBottom: 6, backgroundColor: COLORS.bg },
    topSearchInput: {
      height: 44, backgroundColor: COLORS.card, borderRadius: 22, borderWidth: 1, borderColor: COLORS.border,
      paddingHorizontal: 16, fontSize: 15, color: COLORS.text,
    },

    // Barra de escritura estilo WhatsApp
    composerRow: {
      flexDirection: 'row', alignItems: 'flex-end',
      paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8,
      backgroundColor: COLORS.bg,
    },
    composerBox: {
      flex: 1, flexDirection: 'row', alignItems: 'center',
      minHeight: 46, backgroundColor: COLORS.card,
      borderRadius: 23, borderWidth: 1, borderColor: COLORS.border,
      paddingLeft: 16, paddingRight: 4, marginRight: 6,
    },
    composerInput: {
      flex: 1, fontSize: 16, color: COLORS.text,
      paddingTop: 11, paddingBottom: 11, maxHeight: 120,
    },
    composerIconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    composerIcon: { fontSize: 20 },
    composerAction: {
      width: 46, height: 46, borderRadius: 23,
      backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
    },
    composerActionRecording: { backgroundColor: COLORS.danger },
    composerActionIcon: { fontSize: 19, color: COLORS.onPrimary, fontWeight: '800' },

    systemRow: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 24 },
    systemText: {
      fontSize: 11, color: COLORS.textMuted, textAlign: 'center',
      backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
      paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden',
    },
    quoteBox: {
      borderLeftWidth: 3, borderLeftColor: COLORS.accent, borderRadius: 10,
      backgroundColor: 'rgba(0,0,0,0.12)', paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6,
    },
    quoteName: { fontSize: 10, fontWeight: '800', color: COLORS.accent, letterSpacing: 0.5 },
    quoteText: { fontSize: 12, color: COLORS.textMuted },
    quoteTextMine: { fontSize: 12, color: COLORS.onBubbleMine, opacity: 0.8 },
    replyBar: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card,
      borderTopWidth: 1, borderTopColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 8,
    },
    replyBarLabel: { fontSize: 10, fontWeight: '800', color: COLORS.accent, letterSpacing: 1 },
    replyBarText: { fontSize: 12, color: COLORS.text, marginTop: 2 },
    replyBarClose: { fontSize: 18, color: COLORS.textMuted, paddingHorizontal: 8 },
    editedLabel: { fontSize: 9, color: COLORS.textMuted, marginTop: 3, fontStyle: 'italic' },
    deletedText: { fontSize: 13, fontStyle: 'italic', color: COLORS.textMuted },
    reactionsRow: { flexDirection: 'row', marginTop: -4, marginHorizontal: 6 },
    reactionChip: {
      backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
      paddingHorizontal: 6, paddingVertical: 1, marginRight: 4,
    },
    reactionText: { fontSize: 13 },
    banner: { backgroundColor: COLORS.danger, paddingHorizontal: 14, paddingVertical: 10 },
    bannerText: { color: COLORS.onPrimary, fontSize: 12, fontWeight: '600', lineHeight: 17 },
    bannerButtons: { flexDirection: 'row', marginTop: 8 },
    bannerButton: { borderWidth: 1, borderColor: COLORS.onPrimary, borderRadius: 2, paddingHorizontal: 10, paddingVertical: 5, marginRight: 8 },
    bannerButtonText: { color: COLORS.onPrimary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
    modalCard: { backgroundColor: COLORS.bg, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: COLORS.border },
    modalTitle: { fontSize: 13, fontWeight: '800', color: COLORS.accent, letterSpacing: 1.5, marginBottom: 12 },
    modalText: { fontSize: 13, color: COLORS.text, marginBottom: 12, lineHeight: 18 },
    modalOption: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    modalOptionText: { fontSize: 14, color: COLORS.text, fontWeight: '600' },
    modalDangerText: { fontSize: 14, color: COLORS.danger, fontWeight: '700' },
    modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
    modalButton: { paddingHorizontal: 14, paddingVertical: 10, marginLeft: 8 },
    modalButtonText: { fontSize: 12, fontWeight: '800', color: COLORS.accent, letterSpacing: 1 },
    emojiRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    emojiOption: { fontSize: 28, padding: 4 },
    searchBar: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card,
      paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border,
    },
    searchInput: {
      flex: 1, backgroundColor: COLORS.bg, borderRadius: 2, paddingHorizontal: 12, paddingVertical: 8,
      fontSize: 14, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border,
    },
    headerIconButton: { paddingHorizontal: 8, paddingVertical: 6 },
    headerIconText: { fontSize: 18 },
    unreadBadge: {
      minWidth: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.accent,
      alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginRight: 8,
    },
    unreadBadgeText: { fontSize: 11, fontWeight: '800', color: COLORS.onAccent },
    warningText: { fontSize: 10, color: COLORS.danger, marginTop: 2, fontWeight: '800', letterSpacing: 0.5 },
    verifiedText: { fontSize: 10, color: COLORS.primary, marginTop: 2, fontWeight: '800', letterSpacing: 0.5 },
    screenBody: { padding: 16 },
    infoSectionTitle: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1.5, marginTop: 18, marginBottom: 8 },
    infoText: { fontSize: 13, color: COLORS.text, lineHeight: 19 },
    safetyGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, padding: 12, borderRadius: 18 },
    safetyGroup: { width: '25%', fontSize: 17, fontWeight: '700', color: COLORS.text, textAlign: 'center', paddingVertical: 6, letterSpacing: 1 },
    secondaryButton: {
      width: '100%', borderWidth: 1, borderColor: COLORS.border, borderRadius: 22,
      paddingVertical: 13, alignItems: 'center', marginTop: 10, backgroundColor: COLORS.card,
    },
    secondaryButtonText: { color: COLORS.text, fontWeight: '800', fontSize: 12, letterSpacing: 1 },
    dangerButtonText: { color: COLORS.danger, fontWeight: '800', fontSize: 12, letterSpacing: 1 },
    settingsRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 14, marginBottom: 8,
    },
    settingsLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text },
    settingsHint: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
    lockScreen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', padding: 32 },
    lockTitle: { fontSize: 18, fontWeight: '800', color: COLORS.onPrimary, letterSpacing: 3, marginVertical: 16 },
    mediaPlaceholder: { width: 220, height: 120, alignItems: 'center', justifyContent: 'center' },
    mediaPlaceholderText: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', paddingHorizontal: 12 },
    mediaPlaceholderTextMine: { fontSize: 12, color: COLORS.onBubbleMine, opacity: 0.8, textAlign: 'center', paddingHorizontal: 12 },
  });
}
