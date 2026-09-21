import Foundation

/// Reassembles a byte stream into whole lines.
///
/// A pipe delivers arbitrary chunks, so a single NDJSON event routinely
/// straddles two reads. Decoding each chunk directly would drop those events
/// silently -- progress would simply stall rather than fail -- so incomplete
/// tails are held back until their newline arrives.
public struct LineBuffer {
  private var pending = Data()

  public init() {}

  /// Append a chunk and return whatever complete lines it finished.
  public mutating func append(_ data: Data) -> [String] {
    pending.append(data)

    var lines: [String] = []
    while let newline = pending.firstIndex(of: UInt8(ascii: "\n")) {
      let line = pending[pending.startIndex..<newline]
      pending = pending[pending.index(after: newline)...]
      lines.append(Self.decode(line))
    }

    // Re-base so the indices stay small over a long-running export.
    pending = Data(pending)
    return lines
  }

  /// Return any trailing content left without a newline, once the stream ends.
  public mutating func flush() -> String? {
    guard !pending.isEmpty else { return nil }
    let line = Self.decode(pending)
    pending = Data()
    return line
  }

  private static func decode(_ data: Data) -> String {
    let line = String(decoding: data, as: UTF8.self)
    return line.hasSuffix("\r") ? String(line.dropLast()) : line
  }
}
