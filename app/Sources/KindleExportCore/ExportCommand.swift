import Foundation

/// One invocation of a pipeline script.
///
/// The app always passes paths explicitly rather than relying on the CLI's
/// defaults, which are deliberately unchanged for terminal use and would
/// otherwise write into the repo's `out/` directory.
public struct ExportCommand: Equatable, Sendable {
  public let step: ExportStep
  public let asin: String
  public let workDir: String
  public let userDataDir: String
  public let outFile: String?
  public let limit: Int?
  public let force: Bool
  /// Kokoro voice id, for the narration step.
  public let voice: String?
  /// Narration speed, 1 being the voice's natural pace.
  public let speed: Double?

  public init(
    step: ExportStep,
    asin: String,
    workDir: String,
    userDataDir: String,
    outFile: String? = nil,
    limit: Int? = nil,
    force: Bool = false,
    voice: String? = nil,
    speed: Double? = nil
  ) {
    self.step = step
    self.asin = asin
    self.workDir = workDir
    self.userDataDir = userDataDir
    self.outFile = outFile
    self.limit = limit
    self.force = force
    self.voice = voice
    self.speed = speed
  }

  /// Trim a trailing ".0" so 0.9 and 1.25 both read naturally.
  public static func format(_ speed: Double) -> String {
    speed == speed.rounded()
      ? String(Int(speed))
      : String(speed)
  }

  /// The script this step runs, relative to the repo root.
  public var scriptPath: String {
    switch step {
    case .extractBook: "src/extract-kindle-book.ts"
    case .transcribe: "src/transcribe-book-content.ts"
    case .clean: "src/clean-transcription.ts"
    case .markdown: "src/export-book-markdown.ts"
    case .pdf: "src/export-book-pdf.ts"
    case .audio: "src/narrate-book.ts"
    }
  }

  /// Arguments after the script path. Always includes `--json`, since the app
  /// reads NDJSON rather than prose.
  public var arguments: [String] {
    var args = [
      "--asin", asin,
      "--work-dir", workDir,
      "--user-data-dir", userDataDir,
      "--json",
    ]

    if let outFile {
      args += ["--out-file", outFile]
    }
    if let limit {
      args += ["--limit", String(limit)]
    }
    if force {
      args.append("--force")
    }
    // Only the narration step understands a voice or a pace.
    if step == .audio {
      if let voice {
        args += ["--voice", voice]
      }
      // Omitted at the natural pace, so the command stays the shorter form.
      if let speed, speed != 1 {
        args += ["--speed", Self.format(speed)]
      }
    }

    return args
  }
}
