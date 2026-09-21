import Foundation

/// Where a scrolling view currently sits, in points.
///
/// The view layer measures this; the decision that hangs off it -- whether a
/// log panel should keep following its newest line -- lives here so it can be
/// tested without a running app.
public struct ScrollMetrics: Equatable, Sendable {
  /// How far the content has been scrolled up past the top of the viewport.
  public var offset: Double
  public var contentHeight: Double
  public var viewportHeight: Double

  public init(
    offset: Double = 0,
    contentHeight: Double = 0,
    viewportHeight: Double = 0
  ) {
    self.offset = offset
    self.contentHeight = contentHeight
    self.viewportHeight = viewportHeight
  }

  /// How close to the end still counts as being at the end.
  ///
  /// The measured content height and the offset the scroll view settles on
  /// disagree by a fraction of a point routinely, and a lazily-built stack
  /// revises its height as rows are realised. Demanding an exact match would
  /// drop out of following at the bottom of almost every scroll.
  public static let bottomSlop: Double = 16

  /// The furthest the content can be scrolled. Zero when it all fits.
  public var maxOffset: Double {
    max(0, contentHeight - viewportHeight)
  }

  /// Whether the reader is at (or close enough to) the end of the content.
  public func isAtBottom(slop: Double = ScrollMetrics.bottomSlop) -> Bool {
    // An unmeasurable viewport means the panel has not laid out yet. Treating
    // that as "at the bottom" keeps a freshly opened log tailing rather than
    // stranding it wherever the first frame happened to land.
    guard offset.isFinite, contentHeight.isFinite, viewportHeight.isFinite else {
      return true
    }
    return offset >= maxOffset - slop
  }
}
