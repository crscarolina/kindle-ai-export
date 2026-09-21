import KindleExportCore
import UserNotifications

/// Posts a system notification when an export ends.
///
/// A full book takes hours, so the reader is almost certainly elsewhere when
/// it finishes. Without this the only way to find out is to come back and look.
@MainActor
final class Notifier {
  private var authorization: Bool?

  /// Notifications need a bundle identifier, which only exists when running
  /// as a real `.app`. Launched straight from `swift run` there is none, and
  /// touching the notification centre would trap rather than fail.
  private var isAvailable: Bool {
    Bundle.main.bundleIdentifier != nil
  }

  /// Ask once, at launch, rather than at the end of a long job -- a
  /// permission dialog appearing hours later, unprompted, is startling.
  func requestAuthorization() async {
    guard isAvailable, authorization == nil else { return }

    do {
      authorization = try await UNUserNotificationCenter.current()
        .requestAuthorization(options: [.alert, .sound])
    } catch {
      authorization = false
    }
  }

  func post(_ notification: JobNotification) async {
    guard isAvailable else { return }

    if authorization == nil {
      await requestAuthorization()
    }
    guard authorization == true else { return }

    let content = UNMutableNotificationContent()
    content.title = notification.title
    content.body = notification.body
    content.sound = notification.isFailure ? .defaultCritical : .default

    // No trigger means deliver now.
    let request = UNNotificationRequest(
      identifier: UUID().uuidString, content: content, trigger: nil)

    try? await UNUserNotificationCenter.current().add(request)
  }
}
