import Foundation

/// What the reader asked for in the export panel.
public struct ExportOptions: Equatable, Sendable {
  /// Artifacts to produce. Order within the pipeline is fixed, not by set.
  public var formats: Set<ExportStep>
  /// Run the Claude narration/cleanup pass before producing artifacts.
  public var clean: Bool
  /// Redo steps that are already complete.
  public var force: Bool
  /// Cap pages, for previewing a book without a full run.
  public var limit: Int?
  /// Kokoro voice id for narration.
  public var voice: String
  /// Narration speed, 1 being the voice's natural pace.
  public var speed: Double

  public init(
    formats: Set<ExportStep> = [.markdown],
    clean: Bool = true,
    force: Bool = false,
    limit: Int? = nil,
    voice: String = "af_heart",
    speed: Double = 1
  ) {
    self.formats = formats
    self.clean = clean
    self.force = force
    self.limit = limit
    self.voice = voice
    self.speed = speed
  }
}

/// What already exists in a book's working set.
///
/// Each flag means *complete*, not *present*. A directory with 50 of 400
/// screenshots in it is an interrupted extraction, and treating it as done
/// would transcribe a truncated book and report success.
public struct BookState: Equatable, Sendable {
  public var capturedPages: Int
  public var expectedPages: Int?
  /// Chunks in content.json, and the page count they were produced from.
  public var transcribedChunks: Int
  public var cleanedChunks: Int

  public init(
    capturedPages: Int = 0,
    expectedPages: Int? = nil,
    transcribedChunks: Int = 0,
    cleanedChunks: Int = 0
  ) {
    self.capturedPages = capturedPages
    self.expectedPages = expectedPages
    self.transcribedChunks = transcribedChunks
    self.cleanedChunks = cleanedChunks
  }

  /// Extraction is only complete when metadata says how many pages to expect
  /// and that many are on disk. Without metadata we cannot know, so we re-run.
  public var hasPages: Bool {
    guard let expectedPages, expectedPages > 0 else { return false }
    return capturedPages >= expectedPages
  }

  /// Completeness cascades: content produced from a partial capture is
  /// itself partial, however many chunks it happens to contain.
  public var hasContent: Bool {
    hasPages && transcribedChunks > 0 && transcribedChunks >= capturedPages
  }

  public var hasCleanedContent: Bool {
    hasContent && cleanedChunks > 0 && cleanedChunks >= transcribedChunks
  }
}

public enum ExportPlan {
  /// The pipeline order. Artifacts come last and depend on everything before.
  static let artifactOrder: [ExportStep] = [.markdown, .pdf, .audio]

  /// Build the ordered list of commands for one export.
  ///
  /// Completed steps are skipped unless `force` is set, so re-exporting a book
  /// to a new destination doesn't re-screenshot 400 pages.
  public static func commands(
    asin: String,
    options: ExportOptions,
    state: BookState,
    workDir: String,
    userDataDir: String,
    destination: String?
  ) -> [ExportCommand] {
    var commands: [ExportCommand] = []

    func add(_ step: ExportStep, outFile: String? = nil) {
      commands.append(
        ExportCommand(
          step: step, asin: asin, workDir: workDir, userDataDir: userDataDir,
          outFile: outFile, limit: options.limit, force: options.force,
          voice: options.voice, speed: options.speed))
    }

    // A preview run leaves a deliberately partial working set behind, so it
    // can never satisfy a later full export. Without this, previewing a book
    // and then exporting it properly would silently produce a 50-page result.
    let isPreview = options.limit != nil
    let skipCompleted = !options.force && !isPreview

    if !skipCompleted || !state.hasPages {
      add(.extractBook)
    }
    if !skipCompleted || !state.hasContent {
      add(.transcribe)
    }
    if options.clean, !skipCompleted || !state.hasCleanedContent {
      add(.clean)
    }

    for step in artifactOrder where options.formats.contains(step) {
      add(step, outFile: destination.map { artifactPath(in: $0, step: step, asin: asin) })
    }

    return commands
  }

  /// Where an artifact lands inside the reader's chosen destination folder.
  public static func artifactPath(in destination: String, step: ExportStep, asin: String)
    -> String
  {
    URL(fileURLWithPath: destination)
      .appending(path: "\(asin)\(fileExtension(for: step))")
      .path(percentEncoded: false)
  }

  static func fileExtension(for step: ExportStep) -> String {
    switch step {
    case .markdown: ".md"
    case .pdf: ".pdf"
    case .audio: ".m4b"
    default: ""
    }
  }
}
