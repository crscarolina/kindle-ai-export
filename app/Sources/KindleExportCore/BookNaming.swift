import Foundation

/// How a finished book is named in the reader's destination folder.
///
/// The working directory is keyed by ASIN because machines read it. The
/// destination folder is read by a person, so the name leads with the author's
/// surname (which is how a shelf sorts), then the title, then the ASIN, which
/// is the only part that identifies the edition unambiguously and the part a
/// script can match on.
public struct BookNaming: Equatable, Sendable {
  public var title: String
  /// As the library lists them, in reading order: "Juliet Marillier".
  public var authors: [String]
  /// Year of first publication, when it is genuinely known.
  ///
  /// Nothing the pipeline captures carries one today -- `meta.releaseDate` is
  /// absent from the metadata Amazon now returns -- and a year invented from
  /// a series number or a hunch is worse than no year at all, because it looks
  /// authoritative. So the segment is simply left out unless a caller has a
  /// real one to hand.
  public var year: Int?

  public init(title: String = "", authors: [String] = [], year: Int? = nil) {
    self.title = title
    self.authors = authors
    self.year = year
  }

  /// macOS allows 255 bytes per path component, so the name is capped in
  /// bytes rather than characters -- an accented or CJK title reaches the
  /// limit in far fewer characters than an English one.
  static let maximumBytes = 255

  public func fileName(asin: String, fileExtension: String) -> String {
    let identifier = Self.slug(asin)
    var tail = "(\(identifier))"
    if let year {
      tail = "(\(year))_" + tail
    }

    let descriptive =
      [Self.sortableAuthor(authors), Self.slug(title)]
      .compactMap { $0 }
      .filter { !$0.isEmpty }
      .joined(separator: "_-_")

    // Nothing to describe the book by: the bare ASIN is a better name than a
    // file called "(B003R50A4Q)".
    guard !descriptive.isEmpty || year != nil else {
      return identifier + fileExtension
    }

    // The ASIN, the year and the extension are what make the file findable,
    // so the title gives up its tail to keep them whole.
    let budget = Self.maximumBytes - tail.utf8.count - fileExtension.utf8.count - 1
    let head = Self.truncate(descriptive, toBytes: max(budget, 0))
    let stem = head.isEmpty ? tail : head + "_" + tail

    return Self.collapseSeparators(stem) + fileExtension
  }

  /// "Juliet Marillier" becomes "Marillier, Juliet", so the folder sorts the
  /// way a bookshelf does.
  ///
  /// Only the first author is used. A filename is not a credits page, and
  /// three names ahead of a long title spend the length budget on the part
  /// that identifies the book least.
  ///
  /// The surname is taken to be the last whitespace-separated token. No rule
  /// short of a name database can tell "Le Guin" or "King Jr." apart from a
  /// forename, so "Ursula K. Le Guin" becomes "Guin, Ursula K. Le" -- wrong,
  /// but wrong the same way every time, which keeps the name stable.
  static func sortableAuthor(_ authors: [String]) -> String? {
    guard
      let author = authors.first(where: {
        !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      })
    else { return nil }

    // A comma means the source already reversed the name; reversing again
    // would produce "Juliet, Marillier".
    guard !author.contains(",") else { return slug(author) }

    let parts = author.split(whereSeparator: { $0.isWhitespace })
    // A mononym ("qntm") has no surname to hoist, and "qntm, " would be a lie.
    guard parts.count > 1, let surname = parts.last else { return slug(author) }

    return slug("\(surname), \(parts.dropLast().joined(separator: " "))")
  }

  /// Make one filename segment out of free text: spaces become underscores,
  /// and anything hostile to a filesystem or a terminal is removed.
  ///
  /// The mapping is a deny-list rather than an allow-list on purpose: a
  /// title in Japanese or Polish must survive intact, and an allow-list of
  /// safe characters would reduce it to underscores.
  static func slug(_ text: String) -> String {
    var scalars = String.UnicodeScalarView()

    for scalar in text.unicodeScalars {
      // Tabs and newlines are control characters too, but they stand for a
      // gap between words, so they are tested first and become separators.
      if CharacterSet.whitespacesAndNewlines.contains(scalar) {
        scalars.append(" ")
        continue
      }

      // NUL and friends are illegal in a path component and invisible in a
      // listing, so they are dropped rather than substituted.
      if CharacterSet.controlCharacters.contains(scalar) { continue }

      switch scalar {
      // A colon is legal in APFS, but Finder draws it as a slash and tools
      // that read "host:path" (scp, rsync) mistake it for a remote. The
      // subtitle boundary it marked is kept as a dash.
      case ":":
        scalars.append(contentsOf: " - ".unicodeScalars)
      // A slash would start a new path component; a backslash escapes.
      case "/", "\\":
        scalars.append("-")
      // Quotes and glob characters are legal but turn a copied path into a
      // shell puzzle. Dropped outright so "Sorcerer's" stays one word.
      case "*", "?", "<", ">", "|", "\"", "'", "`", "\u{2018}", "\u{2019}", "\u{201C}",
        "\u{201D}":
        continue
      default:
        scalars.append(scalar)
      }
    }

    let joined = String(scalars).split(separator: " ").joined(separator: "_")
    // A leading dot hides the file; a leading dash makes every command that
    // touches it read the name as an option.
    return joined.trimmingCharacters(in: CharacterSet(charactersIn: "._- "))
  }

  /// Squeeze runs of underscores, which a title full of punctuation produces,
  /// so the result does not look mangled.
  static func collapseSeparators(_ text: String) -> String {
    var out = ""
    var lastWasSeparator = false

    for character in text {
      let isSeparator = character == "_"
      if isSeparator && lastWasSeparator { continue }
      out.append(character)
      lastWasSeparator = isSeparator
    }

    return out
  }

  /// Cut `text` to at most `limit` UTF-8 bytes on a character boundary.
  ///
  /// Truncating the byte buffer directly would split a multi-scalar grapheme
  /// and leave an invalid name behind.
  static func truncate(_ text: String, toBytes limit: Int) -> String {
    guard text.utf8.count > limit else { return text }

    var out = ""
    var used = 0
    for character in text {
      let width = String(character).utf8.count
      if used + width > limit { break }
      out.append(character)
      used += width
    }

    // Do not leave the cut end dangling on a separator.
    return out.trimmingCharacters(in: CharacterSet(charactersIn: "._- "))
  }
}
