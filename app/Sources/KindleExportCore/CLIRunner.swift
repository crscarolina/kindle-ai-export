import Foundation

/// Where the Node pipeline lives and how to run it.
public struct ToolchainConfig: Sendable {
  public let repoRoot: URL
  public let nodeExecutable: URL

  public init(repoRoot: URL, nodeExecutable: URL? = nil) {
    self.repoRoot = repoRoot
    self.nodeExecutable =
      nodeExecutable ?? Self.locateNode() ?? URL(fileURLWithPath: "/usr/bin/env")
  }

  /// Common install prefixes, in the order a shell would find them.
  ///
  /// Hardcoding one prefix breaks on most current Macs: Apple-silicon
  /// Homebrew uses /opt/homebrew, and nvm, fnm and Volta each use their own.
  static let nodeSearchPaths = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
  ]

  public static func locateNode() -> URL? {
    let fm = FileManager.default

    if let path = ProcessInfo.processInfo.environment["PATH"] {
      for prefix in path.split(separator: ":") {
        let candidate = String(prefix) + "/node"
        if fm.isExecutableFile(atPath: candidate) {
          return URL(fileURLWithPath: candidate)
        }
      }
    }

    return nodeSearchPaths.first(where: fm.isExecutableFile(atPath:))
      .map { URL(fileURLWithPath: $0) }
  }

  /// tsx's own JS entry point.
  ///
  /// Not `node_modules/.bin/tsx`: that is a shell wrapper, and handing it to
  /// `node` fails with a syntax error on its shebang line.
  var tsxPath: String {
    repoRoot.appending(path: "node_modules/tsx/dist/cli.mjs")
      .path(percentEncoded: false)
  }
}

public enum CLIRunnerError: Error, LocalizedError {
  case sessionExpired
  case failed(step: ExportStep, exitCode: Int32, stderr: String)

  public var errorDescription: String? {
    switch self {
    case .sessionExpired:
      "Amazon session expired. Sign in again from Settings."
    case .failed(let step, let code, let stderr):
      "\(step.rawValue) failed (exit \(code))\n\(stderr.suffix(2000))"
    }
  }
}

/// Runs one pipeline script and streams its NDJSON progress back.
public final class CLIRunner: @unchecked Sendable {
  private let config: ToolchainConfig

  public init(config: ToolchainConfig) {
    self.config = config
  }

  /// Run a command to completion.
  ///
  /// Credentials are passed through the environment, never argv, since
  /// process arguments are world-readable via `ps`.
  public func run(
    _ command: ExportCommand,
    credentials: [String: String] = [:],
    onEvent: @escaping @Sendable (ExportEvent) -> Void
  ) async throws {
    try await runScript(
      command.scriptPath, arguments: command.arguments, step: command.step,
      credentials: credentials, onEvent: onEvent)
  }

  /// Run a script that isn't part of the export pipeline, such as the
  /// one-time sign-in or the library listing.
  public func runScript(
    _ scriptPath: String,
    arguments: [String],
    step: ExportStep = .extractBook,
    credentials: [String: String] = [:],
    onEvent: @escaping @Sendable (ExportEvent) -> Void
  ) async throws {
    let command = (scriptPath: scriptPath, arguments: arguments, step: step)
    let process = Process()
    process.executableURL = config.nodeExecutable
    process.currentDirectoryURL = config.repoRoot
    process.arguments = [config.tsxPath, command.scriptPath] + command.arguments

    var environment = ProcessInfo.processInfo.environment
    for (key, value) in credentials {
      environment[key] = value
    }
    process.environment = environment

    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr

    let state = RunState()

    stdout.fileHandleForReading.readabilityHandler = { handle in
      let data = handle.availableData
      guard !data.isEmpty else { return }
      for line in state.appendStdout(data) {
        guard let event = ExportEvent.decode(line: line) else { continue }
        if case .sessionExpired = event { state.markSessionExpired() }
        onEvent(event)
      }
    }

    stderr.fileHandleForReading.readabilityHandler = { handle in
      let data = handle.availableData
      guard !data.isEmpty else { return }
      for line in state.appendStderr(data) where !line.isEmpty {
        onEvent(.log(line))
      }
    }

    // Arm the handler before starting the child. A script that fails fast --
    // a bad tsx path, a syntax error, a missing credential -- can exit before
    // a handler installed afterwards is ever called, leaving the job hung in
    // .running and the serial queue wedged for the rest of the session.
    let exited = Exited()
    process.terminationHandler = { _ in exited.signal() }

    try process.run()
    await exited.wait()

    stdout.fileHandleForReading.readabilityHandler = nil
    stderr.fileHandleForReading.readabilityHandler = nil

    // Drain whatever is still sitting in the pipes. The scripts emit
    // step-done and done immediately before exiting, so the terminal events
    // are exactly the ones a premature close would discard.
    let remainingOut = stdout.fileHandleForReading.readDataToEndOfFile()
    if !remainingOut.isEmpty {
      for line in state.appendStdout(remainingOut) {
        if let event = ExportEvent.decode(line: line) {
          if case .sessionExpired = event { state.markSessionExpired() }
          onEvent(event)
        }
      }
    }

    let remainingErr = stderr.fileHandleForReading.readDataToEndOfFile()
    if !remainingErr.isEmpty {
      for line in state.appendStderr(remainingErr) where !line.isEmpty {
        onEvent(.log(line))
      }
    }

    for line in state.flush() {
      if let event = ExportEvent.decode(line: line) {
        if case .sessionExpired = event { state.markSessionExpired() }
        onEvent(event)
      }
    }

    guard process.terminationStatus == 0 else {
      if state.sessionExpired {
        throw CLIRunnerError.sessionExpired
      }
      throw CLIRunnerError.failed(
        step: command.step,
        exitCode: process.terminationStatus,
        stderr: state.stderrText)
    }
  }
}

/// Serialises the buffers the two pipe handlers write into.
private final class RunState: @unchecked Sendable {
  private let lock = NSLock()
  private var out = LineBuffer()
  private var err = LineBuffer()
  private var collectedStderr: [String] = []
  private var expired = false

  func appendStdout(_ data: Data) -> [String] {
    lock.withLock { out.append(data) }
  }

  func appendStderr(_ data: Data) -> [String] {
    lock.withLock {
      let lines = err.append(data)
      collectedStderr += lines
      return lines
    }
  }

  func flush() -> [String] {
    lock.withLock {
      var lines: [String] = []
      if let tail = out.flush() { lines.append(tail) }
      if let tail = err.flush() { collectedStderr.append(tail) }
      return lines
    }
  }

  func markSessionExpired() {
    lock.withLock { expired = true }
  }

  var sessionExpired: Bool { lock.withLock { expired } }
  var stderrText: String { lock.withLock { collectedStderr.joined(separator: "\n") } }
}

/// One-shot termination signal.
///
/// Tolerates the child exiting before the caller starts waiting, which a
/// bare continuation does not.
private final class Exited: @unchecked Sendable {
  private let lock = NSLock()
  private var hasExited = false
  private var continuation: CheckedContinuation<Void, Never>?

  func signal() {
    let pending: CheckedContinuation<Void, Never>? = lock.withLock {
      hasExited = true
      defer { continuation = nil }
      return continuation
    }
    pending?.resume()
  }

  func wait() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      let alreadyExited: Bool = lock.withLock {
        if hasExited { return true }
        self.continuation = continuation
        return false
      }
      if alreadyExited { continuation.resume() }
    }
  }
}
