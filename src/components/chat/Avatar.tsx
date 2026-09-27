import { Image, StyleSheet, Text, View } from 'react-native';

const AVATAR_PALETTE = ['#4B5320', '#B8862E', '#5C6B32', '#8C2F1E', '#6B7A3A', '#7A6A3E'];

function avatarColor(name: string) {
  const sum = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

export function Avatar({ name, size = 40, photoBase64, round }: { name: string; size?: number; photoBase64?: string | null; round?: boolean }) {
  const borderRadius = round ? size / 2 : size * 0.18;
  if (photoBase64) {
    return (
      <Image
        source={{ uri: `data:image/jpeg;base64,${photoBase64}` }}
        style={{ width: size, height: size, borderRadius }}
      />
    );
  }
  return (
    <View style={[avatarStyles.square, { width: size, height: size, borderRadius, backgroundColor: avatarColor(name) }]}>
      <Text style={[avatarStyles.letter, { fontSize: size * 0.42 }]}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const avatarStyles = StyleSheet.create({
  square: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#fff', fontWeight: '800' },
});
