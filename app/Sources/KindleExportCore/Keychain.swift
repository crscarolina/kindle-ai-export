import Foundation
import Security

/// Storage for the Amazon password.
///
/// The password is deliberately kept out of `UserDefaults` and out of the
/// repo's `.env`, and it is handed to the Node scripts through the
/// environment rather than argv -- process arguments are readable by any
/// other process via `ps`.
public enum Keychain {
  public static let service = "com.kindle-ai-export.amazon"

  public static func set(_ value: String, account: String) throws {
    try delete(account: account)

    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: Data(value.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
    ]

    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw KeychainError.unexpectedStatus(status)
    }
  }

  public static func get(account: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }

    return String(decoding: data, as: UTF8.self)
  }

  public static func delete(account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]

    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainError.unexpectedStatus(status)
    }
  }

  public enum KeychainError: Error, LocalizedError {
    case unexpectedStatus(OSStatus)

    public var errorDescription: String? {
      switch self {
      case .unexpectedStatus(let status):
        "Keychain error \(status)"
      }
    }
  }
}
