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

  public init(
    formats: Set<ExportStep> = [.markdown],
    clean: Bool = true,
    force: Bool = false,
    limit: Int? = nil
  ) {
    self.formats = formats
    self.clean = clean
    self.force = force
    self.limit = limit
  }
}

/// What already exists in a book's working set.
public struct BookState: Equatable, Sendable {
  public var hasPages: Bool
  public var hasContent: Bool
  public var hasCleanedContent: Bool

  public init(
    hasPages: Bool = false,
    hasContent: Bool = false,
    hasCleanedContent: Bool = false
  ) {
    self.hasPages = hasPages
    self.hasContent = hasContent
    self.hasCleanedContent = hasCleanedContent
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
          outFile: outFile, limit: options.limit, force: options.force))
    }

    if options.force || !state.hasPages {
      add(.extractBook)
    }
    if options.force || !state.hasContent {
      add(.transcribe)
    }
    if options.clean, options.force || !state.hasCleanedContent {
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
    case .audio: ".wav"
    default: ""
    }
  }
}
