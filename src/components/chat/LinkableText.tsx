import { Linking, Text } from 'react-native';

const URL_SPLIT_REGEX = /((?:https?:\/\/|www\.)[^\s]+)/gi;
const URL_TEST_REGEX = /^(?:https?:\/\/|www\.)/i;

export function LinkableText({ text, textStyle, linkStyle }: { text: string; textStyle: any; linkStyle: any }) {
  const parts = text.split(URL_SPLIT_REGEX);
  return (
    <Text style={textStyle}>
      {parts.map((part, i) => {
        if (URL_TEST_REGEX.test(part)) {
          const url = part.toLowerCase().startsWith('http') ? part : `https://${part}`;
          return (
            <Text key={i} style={linkStyle} onPress={() => Linking.openURL(url).catch(() => {})}>
              {part}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}
