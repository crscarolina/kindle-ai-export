import Foundation

/// A step in the export pipeline.
public enum ExportStep: String, Codable, Sendable, CaseIterable {
  case extractBook = "extract"
  case transcribe
  case clean
  case markdown
  case pdf
  case audio
}

/// A progress event emitted by the Node pipeline as NDJSON.
///
/// Mirrors the `ExportEvent` union in `src/lib/events.ts`. The two must stay
/// in step: the app's progress reporting and its session-expiry handling both
/// hang off this decoding.
public enum ExportEvent: Equatable, Sendable {
  case stepStart(ExportStep)
  case stepDone(ExportStep)
  case page(index: Int, page: Int, total: Int)
  case bookMeta(asin: String, title: String, authors: [String])
  case sessionExpired
  case log(String)
  case error(String)
  case done(outFile: String?)
}

private struct RawEvent: Decodable {
  let event: String
  let step: ExportStep?
  let index: Int?
  let page: Int?
  let total: Int?
  let asin: String?
  let title: String?
  let authors: [String]?
  let message: String?
  let outFile: String?
}

extension ExportEvent {
  /// Decode one NDJSON line.
  ///
  /// Returns `nil` for anything that isn't an event. The scripts still write
  /// prose to stderr and npm writes warnings of its own, so the decoder has to
  /// shrug off non-JSON rather than treat it as a failure.
  public static func decode(line: String) -> ExportEvent? {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.hasPrefix("{") else { return nil }
    guard let data = trimmed.data(using: .utf8),
      let raw = try? JSONDecoder().decode(RawEvent.self, from: data)
    else { return nil }

    switch raw.event {
    case "step-start":
      return raw.step.map(ExportEvent.stepStart)
    case "step-done":
      return raw.step.map(ExportEvent.stepDone)
    case "page":
      guard let index = raw.index, let page = raw.page, let total = raw.total
      else { return nil }
      return .page(index: index, page: page, total: total)
    case "book-meta":
      guard let asin = raw.asin, let title = raw.title else { return nil }
      return .bookMeta(asin: asin, title: title, authors: raw.authors ?? [])
    case "session-expired":
      return .sessionExpired
    case "log":
      return raw.message.map(ExportEvent.log)
    case "error":
      return raw.message.map(ExportEvent.error)
    case "done":
      return .done(outFile: raw.outFile)
    default:
      return nil
    }
  }
}
