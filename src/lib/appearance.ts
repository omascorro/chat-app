// Apariencia de la app: tema, modo claro/oscuro y fondos de los chats. Se guarda en este telefono.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { useSyncExternalStore } from 'react';
import { DEFAULT_THEME_ID } from '../components/chat/theme';
import { randomHex } from './crypto/primitives';
import { log } from './log';
import { deleteFile, deleteIfAppFile } from './media';

export type Wallpaper =
  | { type: 'none' }
  | { type: 'color'; color: string }
  | { type: 'image'; uri: string; dim: number }; // dim: 0 a 0.7, que tanto se oscurece la foto

export type ThemeMode = 'auto' | 'light' | 'dark';

export type Appearance = {
  themeId: string;
  mode: ThemeMode;
  wallpaper: Wallpaper; // fondo general
  perChat: Record<string, Wallpaper>; // fondo propio de algunos chats
};

// Colores de fondo predefinidos (claros y oscuros)
export const WALLPAPER_COLORS = ['#DCE8D2', '#F3E3C3', '#D6E4F0', '#F2D7DE', '#E1DAF0', '#E8E4DA', '#2B3A2E', '#1E2A36', '#3A2632', '#202124'];

const STORAGE_KEY = 'appearance_v1';
const WALLPAPER_DIR = `${FileSystem.documentDirectory}wallpapers/`;

const DEFAULT: Appearance = { themeId: DEFAULT_THEME_ID, mode: 'auto', wallpaper: { type: 'none' }, perChat: {} };

let current: Appearance = DEFAULT;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAppearance() {
  return current;
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance);
}

export async function loadAppearance() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      current = { ...DEFAULT, ...JSON.parse(raw) };
      emit();
    }
  } catch (e) {
    log('No se pudo cargar la apariencia:', e);
  }
}

async function save(next: Appearance) {
  const previousImages = usedImages(current);
  current = next;
  emit();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  // Borrar las fotos de fondo que ya nadie usa
  const stillUsed = usedImages(next);
  for (const uri of previousImages) if (!stillUsed.has(uri)) await deleteFile(uri);
}

function usedImages(a: Appearance): Set<string> {
  const uris = new Set<string>();
  for (const w of [a.wallpaper, ...Object.values(a.perChat)]) if (w.type === 'image') uris.add(w.uri);
  return uris;
}

export function setThemeId(themeId: string) {
  return save({ ...current, themeId });
}

export function setThemeMode(mode: ThemeMode) {
  return save({ ...current, mode });
}

// peer null = fondo general; con peer, el fondo propio de ese chat (null lo quita y vuelve al general)
export function setWallpaper(peer: string | null, wallpaper: Wallpaper | null) {
  if (peer === null) return save({ ...current, wallpaper: wallpaper ?? { type: 'none' } });
  const perChat = { ...current.perChat };
  if (wallpaper) perChat[peer] = wallpaper;
  else delete perChat[peer];
  return save({ ...current, perChat });
}

export function wallpaperFor(appearance: Appearance, peer: string): Wallpaper {
  return appearance.perChat[peer] ?? appearance.wallpaper;
}

// Copia la foto elegida (reducida) a la carpeta de la app, para que no dependa de la galeria
export async function importWallpaperImage(pickedUri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(WALLPAPER_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(WALLPAPER_DIR, { intermediates: true });
  const resized = await ImageManipulator.manipulateAsync(pickedUri, [{ resize: { width: 1400 } }], {
    compress: 0.75,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const dest = `${WALLPAPER_DIR}${randomHex(8)}.jpg`;
  await FileSystem.moveAsync({ from: resized.uri, to: dest });
  await deleteIfAppFile(pickedUri);
  return dest;
}

// Boton de panico: tambien se borran los fondos (pueden ser fotos personales)
export async function resetAppearance() {
  await deleteFile(WALLPAPER_DIR);
  current = DEFAULT;
  emit();
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
