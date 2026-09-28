// Al compartir algo con Aeterna desde otra app, el sistema la abre con un enlace "chatapp://expo-sharing...".
// La app es una sola pantalla (index.tsx) que ya revisa lo compartido, asi que ese enlace solo abre el inicio.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (new URL(path).hostname === 'expo-sharing') return '/';
    return path;
  } catch {
    return '/';
  }
}
