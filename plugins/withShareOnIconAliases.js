// Con un icono alternativo elegido (expo-alternate-app-icons), Android desactiva .MainActivity y usa un
// activity-alias. Los filtros para "Compartir con Aeterna" (expo-sharing) solo estan en .MainActivity, asi que la app
// desaparecia del menu de compartir. Este plugin los copia a cada alias.
const { withAndroidManifest } = require('expo/config-plugins');

const MIME_TYPES = ['image/*', 'video/*'];

function shareFilter(action) {
  return {
    $: { 'android:autoVerify': 'false' },
    action: [{ $: { 'android:name': action } }],
    data: MIME_TYPES.map((mime) => ({ $: { 'android:mimeType': mime } })),
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
  };
}

module.exports = function withShareOnIconAliases(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    for (const alias of app?.['activity-alias'] ?? []) {
      const filters = (alias['intent-filter'] = alias['intent-filter'] ?? []);
      const hasShare = filters.some((f) => (f.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.SEND'));
      if (!hasShare) filters.push(shareFilter('android.intent.action.SEND'), shareFilter('android.intent.action.SEND_MULTIPLE'));
    }
    return cfg;
  });
};
