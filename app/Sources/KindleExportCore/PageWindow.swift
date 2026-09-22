import Foundation

/// How much of a long list is currently rendered, and when to render more.
///
/// A library of a couple of hundred books would otherwise start every cover
/// download the moment the grid appears, so rows are added a page at a time as
/// the reader scrolls towards them. Widening the window is instant -- it is a
/// larger `prefix` of an array already in memory, not a fetch -- so nothing
/// here is asynchronous, and the view must not pretend otherwise.
///
/// The decision of *when* to widen lives here rather than in the view so the
/// boundaries (an exact multiple of the page size, a filtered set smaller than
/// one page, an empty set) can be tested without a running app.
public struct PageWindow: Equatable, Sendable {
  /// Rows added per step. Roughly two screens of covers on a large window.
  public static let defaultPageSize = 60

  /// How far from the end of the rendered rows the next page starts loading.
  ///
  /// Widening once the very last cell appears leaves the reader looking at the
  /// end of the grid for a frame. About one row of lookahead means the next
  /// page is in place by the time they reach it.
  public static let defaultLookahead = 8

  public let pageSize: Int
  public let lookahead: Int

  /// The window's own count, which may exceed the list it is applied to; use
  /// `visibleCount(total:)` for anything the view renders.
  public private(set) var rawCount: Int

  public init(
    pageSize: Int = PageWindow.defaultPageSize,
    lookahead: Int = PageWindow.defaultLookahead
  ) {
    self.pageSize = max(1, pageSize)
    self.lookahead = max(1, lookahead)
    self.rawCount = self.pageSize
  }

  /// How many rows of a list of `total` items are rendered.
  public func visibleCount(total: Int) -> Int {
    min(max(0, total), rawCount)
  }

  /// Whether any rows are held back. False on an exact page boundary, so a
  /// library of exactly 60 or 120 books never shows a "0 more" footer.
  public func hasMore(total: Int) -> Bool {
    visibleCount(total: total) < max(0, total)
  }

  /// How many rows are still held back.
  public func remaining(total: Int) -> Int {
    max(0, total) - visibleCount(total: total)
  }

  /// Whether the cell that just appeared is close enough to the end to widen.
  public func shouldAdvance(appearedIndex: Int, total: Int) -> Bool {
    guard hasMore(total: total) else { return false }
    return appearedIndex >= visibleCount(total: total) - lookahead
  }

  /// Render one more page. Clamped to `total`, and a no-op once everything is
  /// shown, so repeated triggers from re-appearing cells cannot run away.
  public mutating func advance(total: Int) {
    guard hasMore(total: total) else { return }
    rawCount = min(visibleCount(total: total) + pageSize, max(0, total))
  }

  /// Start again from the top, for when the list changes underneath: a new
  /// search term, or a refreshed library.
  public mutating func reset() {
    rawCount = pageSize
  }
}
