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
