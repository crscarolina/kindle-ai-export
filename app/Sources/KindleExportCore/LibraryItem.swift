import Foundation

/// A book in the reader's Kindle library, as `src/list-library.ts` emits it.
public struct LibraryItem: Codable, Equatable, Identifiable, Sendable {
  public let asin: String
  public let title: String
  public let authors: [String]
  public let coverUrl: String?

  public var id: String { asin }

  public var authorLine: String {
    authors.isEmpty ? "Unknown author" : authors.joined(separator: ", ")
  }

  public init(asin: String, title: String, authors: [String], coverUrl: String?) {
    self.asin = asin
    self.title = title
    self.authors = authors
    self.coverUrl = coverUrl
  }
}

/// A Kokoro voice, as `src/list-voices.ts` emits it.
///
/// Read from the pipeline rather than duplicated here, so the picker cannot
/// drift from the voices the narrator will actually accept.
public struct VoiceOption: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let accent: String
  public let gender: String
  public let grade: String
  public let targetQuality: String
  public let traits: String?
  public let description: String
  public let longForm: Bool

  /// Short line for the picker row.
  public var summary: String {
    "\(accent) \(gender.lowercased()) · grade \(grade)"
  }

  public var label: String {
    traits.map { "\(name) \($0)" } ?? name
  }
}
