import CryptoKit
import Foundation
import Security
import UserNotifications

// Aeterna: el servidor manda la notificacion generica ("Tienes un mensaje nuevo") con la vista previa cifrada en
// los datos. Esta extension la descifra con la llave que este iPhone le dio a ese contacto y cambia el titulo y el texto.
// Si cualquier cosa falla, se muestra la notificacion generica tal cual: nunca se pierde el aviso.
//
// Tiene que coincidir con src/lib/preview.ts (version 2, una llave por contacto):
//  - llavero: servicio "aeterna.preview:no-auth" (expo-secure-store agrega ":no-auth"), grupo compartido
//  - datos: "pnk2_<id>" = JSON {"k": llave de 32 bytes en base64, "f": nombre del contacto} y "preview_on"
//  - formato: base64(0x02 | id 8 bytes | nonce 12 | cifrado | tag 16), ChaCha20-Poly1305 con dato asociado
//    "aeterna-preview-v2:<id en hex>", contenido JSON {"b": texto}
//  - el titulo es el nombre guardado junto a la llave, nunca lo que diga el contenido
// El formato viejo (llave unica "pnk") ya no se descifra: se queda el aviso generico.
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
       let preview = open(sealed) {
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

  private struct StoredKey: Decodable {
    let k: String
    let f: String
  }

  private struct Payload: Decodable {
    let b: String
  }

  private func open(_ sealedBase64: String) -> Preview? {
    let kidLength = 8
    guard let bytes = Data(base64Encoded: sealedBase64), bytes.count > 1 + kidLength + 12 + 16,
          bytes[bytes.startIndex] == 0x02 else {
      return nil
    }
    let kidBytes = bytes.subdata(in: (bytes.startIndex + 1)..<(bytes.startIndex + 1 + kidLength))
    let kid = kidBytes.map { String(format: "%02x", $0) }.joined()
    let combined = bytes.subdata(in: (bytes.startIndex + 1 + kidLength)..<bytes.endIndex)
    guard let stored = readKeychain("pnk2_\(kid)"),
          let storedData = stored.data(using: .utf8),
          let entry = try? JSONDecoder().decode(StoredKey.self, from: storedData),
          let key = Data(base64Encoded: entry.k), key.count == 32,
          let box = try? ChaChaPoly.SealedBox(combined: combined),
          let plain = try? ChaChaPoly.open(box, using: SymmetricKey(data: key), authenticating: Data("aeterna-preview-v2:\(kid)".utf8)),
          let payload = try? JSONDecoder().decode(Payload.self, from: plain) else {
      return nil
    }
    return Preview(from: String(entry.f.prefix(60)), text: String(payload.b.prefix(200)))
  }
}
