import CryptoKit
import Foundation
import Security
import UserNotifications

// Aeterna: el servidor manda la notificacion generica ("Tienes un mensaje nuevo") con la vista previa cifrada en
// los datos. Esta extension la descifra con la llave de este iPhone y cambia el titulo y el texto.
// Si cualquier cosa falla, se muestra la notificacion generica tal cual: nunca se pierde el aviso.
//
// Tiene que coincidir con src/lib/preview.ts:
//  - llavero: servicio "aeterna.preview:no-auth" (expo-secure-store agrega ":no-auth"), grupo compartido
//  - datos: "pnk" (llave de 32 bytes en base64) y "preview_on" ("off" = no mostrar contenido)
//  - cifrado: ChaCha20-Poly1305, base64(nonce 12 | cifrado | tag 16), contenido JSON {"f": remitente, "b": texto}
class NotificationService: UNNotificationServiceExtension {
  private let accessGroup = "RMX9T6ZVA9.com.mascorro55.chatapp.shared"
  private let keychainService = "aeterna.preview:no-auth"

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    bestAttempt = content

    if previewsEnabled(),
       let sealed = previewField(content.userInfo),
       let keyString = readKeychain("pnk"),
       let key = Data(base64Encoded: keyString), key.count == 32,
       let preview = decrypt(sealed, key: key) {
      content.title = preview.from
      content.body = preview.text
    }
    contentHandler(content)
  }

  override func serviceExtensionTimeWillExpire() {
    if let handler = contentHandler, let content = bestAttempt {
      handler(content)
    }
  }

  private func previewsEnabled() -> Bool {
    return readKeychain("preview_on") != "off"
  }

  // Expo pone los datos de la notificacion bajo "body"; se revisan tambien otras formas por si cambia
  private func previewField(_ userInfo: [AnyHashable: Any]) -> String? {
    if let body = userInfo["body"] as? [String: Any], let p = body["p"] as? String { return p }
    if let bodyString = userInfo["body"] as? String,
       let data = bodyString.data(using: .utf8),
       let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let p = object["p"] as? String {
      return p
    }
    if let data = userInfo["data"] as? [String: Any], let p = data["p"] as? String { return p }
    if let p = userInfo["p"] as? String { return p }
    return nil
  }

  private func readKeychain(_ name: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: Data(name.utf8),
      kSecAttrAccessGroup as String: accessGroup,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: true,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  private struct Preview {
    let from: String
    let text: String
  }

  private struct Payload: Decodable {
    let f: String
    let b: String
  }

  private func decrypt(_ sealedBase64: String, key: Data) -> Preview? {
    guard let combined = Data(base64Encoded: sealedBase64), combined.count > 28,
          let box = try? ChaChaPoly.SealedBox(combined: combined),
          let plain = try? ChaChaPoly.open(box, using: SymmetricKey(data: key)),
          let payload = try? JSONDecoder().decode(Payload.self, from: plain) else {
      return nil
    }
    return Preview(from: String(payload.f.prefix(60)), text: String(payload.b.prefix(200)))
  }
}
