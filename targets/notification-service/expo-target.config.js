// Extension de notificaciones del iPhone: descifra la vista previa ("Omar: ya llegué") antes de mostrarla.
// La llave vive en el llavero compartido con la app (grupo ...chatapp.shared).
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'notification-service',
  name: 'NotificationService',
  bundleIdentifier: '.notification-service',
  deploymentTarget: '15.1',
  frameworks: ['UserNotifications', 'CryptoKit', 'Security'],
  entitlements: {
    'keychain-access-groups': ['$(AppIdentifierPrefix)com.mascorro55.chatapp.shared'],
  },
};
