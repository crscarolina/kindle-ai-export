import Foundation

/// What to tell the reader when a job stops.
public struct JobNotification: Equatable, Sendable {
  public let title: String
  public let body: String
  /// Whether this reports a problem, so the caller can pick a sound.
  public let isFailure: Bool

  public init(title: String, body: String, isFailure: Bool) {
    self.title = title
    self.body = body
    self.isFailure = isFailure
  }
}

public enum JobOutcome: Equatable, Sendable {
  case finished(artifacts: [String])
  case failed(String)
  case cancelled
}

extension JobNotification {
  /// Compose the notification for a finished job.
  ///
  /// An export runs for hours, so by the time it ends the reader is almost
  /// certainly doing something else. The body therefore has to carry enough
  /// to act on without opening the app -- which book, and where the files
  /// went.
  public static func forOutcome(
    book: String,
    outcome: JobOutcome,
    destination: String? = nil
  ) -> JobNotification {
    switch outcome {
    case .finished(let artifacts):
      return JobNotification(
        title: "Export finished",
        body: finishedBody(
          book: book, artifacts: artifacts, destination: destination),
        isFailure: false)

    case .failed(let reason):
      return JobNotification(
        title: "Export failed",
        // Failures arrive as multi-line stderr; a notification shows a couple
        // of lines at most, so lead with the part that identifies the problem.
        body: "\(book) — \(firstLine(of: reason))",
        isFailure: true)

    case .cancelled:
      return JobNotification(
        title: "Export cancelled", body: book, isFailure: false)
    }
  }

  private static func finishedBody(
    book: String,
    artifacts: [String],
    destination: String?
  ) -> String {
    let names = artifacts.map { ($0 as NSString).lastPathComponent }

    guard !names.isEmpty else {
      return book
    }

    let folder =
      destination.map { ($0 as NSString).lastPathComponent }
      ?? (artifacts[0] as NSString).deletingLastPathComponent
      as NSString as String

    let listed =
      names.count <= 2
      ? names.joined(separator: ", ")
      : "\(names.prefix(2).joined(separator: ", ")) and \(names.count - 2) more"

    return "\(book) — \(listed) in \(folder.isEmpty ? "the chosen folder" : folder)"
  }

  private static func firstLine(of message: String) -> String {
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    let line = trimmed.split(separator: "\n", maxSplits: 1).first.map(String.init)
    return line?.isEmpty == false ? line! : "unknown error"
  }
}
