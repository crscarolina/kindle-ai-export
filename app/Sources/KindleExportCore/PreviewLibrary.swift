import CryptoKit
import Foundation

/// Where the voice auditions come from.
///
/// 224 clips -- 28 voices at 8 paces each -- rendered once on a developer's
/// machine over about a day of Kokoro inference, then published as a release
/// asset. Far too large to commit and pointless to ship in the bundle, since
/// the clips are identical on both architectures and most readers will
/// audition a handful.
///
/// The hash is pinned here rather than fetched alongside the download, for the
/// same reason the ffmpeg one is: a checksum served by the host it vouches for
/// proves nothing. Re-rendering the previews is therefore a code change.
public struct PreviewRelease: Sendable {
  public let url: URL
  public let sha256: String
  public let clipCount: Int

  public init(url: URL, sha256: String, clipCount: Int) {
    self.url = url
    self.sha256 = sha256
    self.clipCount = clipCount
  }

  /// Whether this release is real yet.
  ///
  /// The asset is published by hand after a render finishes, so the checksum
  /// lands in a later commit than the code that uses it. An empty hash means
  /// "not published", and installing refuses rather than downloading something
  /// it cannot vouch for.
  public var isPublished: Bool { !sha256.isEmpty }
}

public let voicePreviewRelease = PreviewRelease(
  url: URL(
    string:
      "https://github.com/crscarolina/kindle-ai-export/releases/download/previews-v1/voice-previews.zip"
  )!,
  sha256: "",
  clipCount: 224)

public enum PreviewInstallError: LocalizedError {
  case notPublished
  case badStatus(Int)
  case checksumMismatch(expected: String, actual: String)
  case extractionFailed(String)
  case empty

  public var errorDescription: String? {
    switch self {
    case .notPublished:
      "Voice previews have not been published for this build yet."
    case .badStatus(let code):
      "Downloading the voice previews failed with HTTP \(code)."
    case .checksumMismatch(let expected, let actual):
      "The voice previews failed their checksum: expected \(expected), got \(actual)."
    case .extractionFailed(let message):
      "Could not unpack the voice previews: \(message)"
    case .empty:
      "The voice preview archive contained no clips."
    }
  }
}

/// How far along a download is, for a progress bar.
public struct PreviewInstallProgress: Equatable, Sendable {
  public let received: Int64
  public let expected: Int64

  public init(received: Int64, expected: Int64) {
    self.received = received
    self.expected = expected
  }

  public var fraction: Double? {
    expected > 0 ? min(1, Double(received) / Double(expected)) : nil
  }
}

/// Holds the in-flight task so progress can be read and cancellation
/// forwarded, across the concurrency domains a completion handler straddles.
private final class TaskBox: @unchecked Sendable {
  private let lock = NSLock()
  private var task: URLSessionDownloadTask?

  func set(_ task: URLSessionDownloadTask) {
    lock.withLock { self.task = task }
  }

  var counts: (received: Int64, expected: Int64)? {
    lock.withLock {
      guard let task else { return nil }
      return (task.countOfBytesReceived, task.countOfBytesExpectedToReceive)
    }
  }

  func cancel() { lock.withLock { task?.cancel() } }
}

public struct PreviewInstaller: Sendable {
  let release: PreviewRelease
  let session: URLSession

  public init(
    release: PreviewRelease = voicePreviewRelease,
    session: URLSession = .shared
  ) {
    self.release = release
    self.session = session
  }

  /// Whether the clips are already on disk.
  ///
  /// Counts files rather than trusting a marker: a half-extracted directory
  /// from an interrupted run would otherwise read as installed and leave the
  /// picker silently short of most of its voices.
  public func isInstalled(in directory: String) -> Bool {
    installedCount(in: directory) >= release.clipCount
  }

  public func installedCount(in directory: String) -> Int {
    let contents =
      (try? FileManager.default.contentsOfDirectory(atPath: directory)) ?? []
    return contents.filter { $0.hasSuffix(".m4b") }.count
  }

  /// Fetch and unpack the clips, reporting progress as they arrive.
  ///
  /// Extraction goes to a sibling directory and is moved into place only once
  /// it is complete, so an interrupted install never leaves a partial set
  /// where a whole one is expected.
  public func install(
    into directory: String,
    onProgress: @escaping @Sendable (PreviewInstallProgress) -> Void
  ) async throws {
    guard release.isPublished else { throw PreviewInstallError.notPublished }

    let archive = try await download(onProgress: onProgress)
    defer { try? FileManager.default.removeItem(at: archive) }

    try verify(archive)

    let parent = URL(fileURLWithPath: directory).deletingLastPathComponent()
    let staging = parent.appending(path: ".previews-incoming")
    try? FileManager.default.removeItem(at: staging)
    try FileManager.default.createDirectory(
      at: staging, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: staging) }

    try extract(archive, into: staging)

    let unpacked = try locateClips(in: staging)
    guard !unpacked.clips.isEmpty else { throw PreviewInstallError.empty }

    let destination = URL(fileURLWithPath: directory)
    try FileManager.default.createDirectory(
      at: destination, withIntermediateDirectories: true)

    // Move file by file rather than swapping the directory: previews rendered
    // locally may already be sitting there, and replacing the directory
    // wholesale would throw them away.
    for clip in unpacked.clips {
      let target = destination.appending(path: clip.lastPathComponent)
      try? FileManager.default.removeItem(at: target)
      try FileManager.default.moveItem(at: clip, to: target)
    }
  }

  private func download(
    onProgress: @escaping @Sendable (PreviewInstallProgress) -> Void
  ) async throws -> URL {
    let destination = FileManager.default.temporaryDirectory
      .appending(path: "voice-previews-\(UUID().uuidString).zip")
    let box = TaskBox()

    // Progress is polled off the task rather than streamed through
    // `URLSession.bytes`, which yields a byte at a time: 271 MB is around 284
    // million async iterations, and the overhead dwarfs the transfer.
    let ticker = Task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(250))
        guard let counts = box.counts else { continue }
        onProgress(
          PreviewInstallProgress(
            received: counts.received, expected: counts.expected))
      }
    }
    defer { ticker.cancel() }

    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let task = session.downloadTask(with: release.url) { tmp, response, error in
          if let error {
            continuation.resume(throwing: error)
            return
          }
          if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            continuation.resume(
              throwing: PreviewInstallError.badStatus(http.statusCode))
            return
          }
          guard let tmp else {
            continuation.resume(throwing: PreviewInstallError.empty)
            return
          }

          // URLSession deletes its temporary file as soon as this handler
          // returns, so the move has to happen here rather than after the
          // await.
          do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: tmp, to: destination)
            continuation.resume(returning: destination)
          } catch {
            continuation.resume(throwing: error)
          }
        }

        box.set(task)
        task.resume()
      }
    } onCancel: {
      box.cancel()
    }
  }

  private func verify(_ archive: URL) throws {
    var hasher = SHA256()
    let handle = try FileHandle(forReadingFrom: archive)
    defer { try? handle.close() }

    // Streamed, so hashing does not hold the whole archive in memory.
    while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
      hasher.update(data: chunk)
    }

    let actual = hasher.finalize().map { String(format: "%02x", $0) }.joined()
    guard actual == release.sha256.lowercased() else {
      throw PreviewInstallError.checksumMismatch(
        expected: release.sha256.lowercased(), actual: actual)
    }
  }

  private func extract(_ archive: URL, into directory: URL) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
    process.arguments = [
      "-x", "-k", archive.path(percentEncoded: false),
      directory.path(percentEncoded: false),
    ]

    let errors = Pipe()
    process.standardError = errors
    process.standardOutput = FileHandle.nullDevice

    try process.run()
    let stderr = errors.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()

    guard process.terminationStatus == 0 else {
      throw PreviewInstallError.extractionFailed(
        String(decoding: stderr, as: UTF8.self)
          .trimmingCharacters(in: .whitespacesAndNewlines))
    }
  }

  /// Find the clips wherever the archive put them.
  ///
  /// Tolerates both a flat zip and one wrapped in a top-level folder, which is
  /// what `ditto -c -k --keepParent` produces -- the same flag the release
  /// workflow uses for the app.
  private func locateClips(in directory: URL) throws -> (clips: [URL], root: URL) {
    let fm = FileManager.default
    var roots = [directory]

    if let entries = try? fm.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: [.isDirectoryKey])
    {
      roots.append(contentsOf: entries.filter { entry in
        (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory)
          == true
      })
    }

    for root in roots {
      let clips =
        ((try? fm.contentsOfDirectory(
          at: root, includingPropertiesForKeys: nil)) ?? [])
        .filter { $0.pathExtension == "m4b" }
      if !clips.isEmpty { return (clips, root) }
    }

    return ([], directory)
  }
}
