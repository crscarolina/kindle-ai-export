import AppKit
import Foundation

/// Runs the real checks behind `RequirementsReport`.
public struct RequirementsChecker: Sendable {
  public init() {}

  /// Chrome, found by bundle identifier rather than by path.
  ///
  /// People move applications, and Playwright launches it by channel anyway,
  /// so asking Launch Services is both more reliable and closer to what the
  /// extractor will actually do.
  public func hasChrome() -> Bool {
    NSWorkspace.shared.urlForApplication(
      withBundleIdentifier: "com.google.Chrome") != nil
  }

  public func claudeExecutable() -> String? {
    locate("claude")
  }

  /// Whether the `claude` CLI is signed in.
  ///
  /// `claude auth status` answers in about a third of a second and prints
  /// JSON. The alternative -- running a real prompt and seeing whether it
  /// errs -- takes several seconds and spends tokens to learn nothing more.
  public func isClaudeSignedIn() async -> Bool {
    guard let claude = claudeExecutable() else { return false }

    guard let output = await run(claude, ["auth", "status"]) else {
      return false
    }

    guard
      let data = output.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data)
        as? [String: Any]
    else {
      // Older versions may print prose. Fall back to reading it, rather than
      // declaring a signed-in user signed out.
      return output.localizedCaseInsensitiveContains("logged in")
        && !output.localizedCaseInsensitiveContains("not logged in")
    }

    return json["loggedIn"] as? Bool ?? false
  }

  // MARK: - Helpers

  private func locate(_ name: String) -> String? {
    let fm = FileManager.default

    if let path = ProcessInfo.processInfo.environment["PATH"] {
      for prefix in path.split(separator: ":") {
        let candidate = "\(prefix)/\(name)"
        if fm.isExecutableFile(atPath: candidate) { return candidate }
      }
    }

    // A GUI app launched from Finder inherits a minimal PATH that has none of
    // the usual install locations in it.
    for candidate in [
      "/opt/homebrew/bin/\(name)",
      "/usr/local/bin/\(name)",
      "\(NSHomeDirectory())/.local/bin/\(name)",
      "\(NSHomeDirectory())/.claude/local/\(name)",
    ] where fm.isExecutableFile(atPath: candidate) {
      return candidate
    }

    return nil
  }

  private func run(_ executable: String, _ arguments: [String]) async -> String? {
    await withCheckedContinuation { continuation in
      let process = Process()
      process.executableURL = URL(fileURLWithPath: executable)
      process.arguments = arguments

      let pipe = Pipe()
      process.standardOutput = pipe
      process.standardError = Pipe()

      // A check that hangs would hold up the whole setup screen. The flag is
      // read from two threads, so it carries its own lock rather than
      // relying on a work item that cannot cross a Sendable boundary.
      let finished = Finished()

      DispatchQueue.global().asyncAfter(deadline: .now() + 10) {
        if !finished.isSet, process.isRunning { process.terminate() }
      }

      process.terminationHandler = { _ in
        finished.set()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        continuation.resume(returning: String(decoding: data, as: UTF8.self))
      }

      do {
        try process.run()
      } catch {
        finished.set()
        continuation.resume(returning: nil)
      }
    }
  }
}

/// A one-way flag shared between the timeout and the termination handler.
private final class Finished: @unchecked Sendable {
  private let lock = NSLock()
  private var value = false

  var isSet: Bool { lock.withLock { value } }
  func set() { lock.withLock { value = true } }
}
