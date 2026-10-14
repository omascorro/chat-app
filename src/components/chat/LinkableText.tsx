import { Linking, Text } from 'react-native';
import { HIGHLIGHT_STYLE, splitByMatches } from '../../lib/highlight';

const URL_SPLIT_REGEX = /((?:https?:\/\/|www\.)[^\s]+)/gi;
const URL_TEST_REGEX = /^(?:https?:\/\/|www\.)/i;

// Lo que coincide con la busqueda de la lupa va con fondo amarillo
function Highlighted({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  return (
    <>
      {splitByMatches(text, query).map((p, i) => (p.match ? <Text key={i} style={HIGHLIGHT_STYLE}>{p.text}</Text> : p.text))}
    </>
  );
}

export function LinkableText({ text, textStyle, linkStyle, highlight }: { text: string; textStyle: any; linkStyle: any; highlight?: string }) {
  const parts = text.split(URL_SPLIT_REGEX);
  return (
    <Text style={textStyle}>
      {parts.map((part, i) => {
        if (URL_TEST_REGEX.test(part)) {
          const url = part.toLowerCase().startsWith('http') ? part : `https://${part}`;
          return (
            <Text key={i} style={linkStyle} onPress={() => Linking.openURL(url).catch(() => {})}>
              <Highlighted text={part} query={highlight} />
            </Text>
          );
        }
        return <Highlighted key={i} text={part} query={highlight} />;
      })}
    </Text>
  );
}
