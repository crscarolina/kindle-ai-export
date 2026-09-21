import Foundation

extension ExportStep {
  /// What to call this step in the interface.
  ///
  /// The raw values are command-line identifiers; showing them verbatim gave
  /// the reader lowercase jargon like "extract" and "pdf".
  public var displayName: String {
    switch self {
    case .extractBook: "Capture Pages"
    case .transcribe: "Read Text"
    case .clean: "Clean Up"
    case .markdown: "Markdown"
    case .pdf: "PDF"
    case .audio: "Audiobook"
    }
  }

  /// A line of explanation, for when the step is the one running.
  public var detail: String {
    switch self {
    case .extractBook: "Photographing each page in the Kindle reader"
    case .transcribe: "Reading the text off each page with Vision OCR"
    case .clean: "Repairing OCR artefacts with Claude"
    case .markdown: "Writing the Markdown file"
    case .pdf: "Writing the PDF"
    case .audio: "Narrating locally with Kokoro"
    }
  }

  public var symbolName: String {
    switch self {
    case .extractBook: "camera"
    case .transcribe: "text.viewfinder"
    case .clean: "wand.and.sparkles"
    case .markdown: "doc.plaintext"
    case .pdf: "doc.richtext"
    case .audio: "waveform"
    }
  }
}

/// Where one step of an export has got to.
public enum StepState: Equatable, Sendable {
  case pending
  case running(completed: Int, total: Int)
  case done
  case failed(String)
  /// Reached only when an earlier step failed, so this one never ran.
  case skipped
}

public struct StepProgress: Equatable, Sendable, Identifiable {
  public let step: ExportStep
  public var state: StepState

  public var id: String { step.rawValue }

  public init(step: ExportStep, state: StepState = .pending) {
    self.step = step
    self.state = state
  }

  /// Fraction complete, or `nil` when there is nothing meaningful to draw.
  ///
  /// A step that has started but not yet reported a total gets no bar rather
  /// than a bar stuck at zero, which reads as stalled.
  public var fraction: Double? {
    switch state {
    case .running(let completed, let total):
      total > 0 ? min(1, Double(completed) / Double(total)) : nil
    case .done:
      1
    case .pending, .failed, .skipped:
      nil
    }
  }

  public var detailText: String {
    switch state {
    case .pending: "Waiting"
    case .running(let completed, let total):
      total > 0 ? "\(completed) of \(total)" : step.detail
    case .done: "Done"
    case .failed(let message): message
    case .skipped: "Skipped"
    }
  }
}

/// The steps of one export, and how far each has got.
public struct JobTimeline: Equatable, Sendable {
  public private(set) var steps: [StepProgress]

  public init(steps: [ExportStep]) {
    self.steps = steps.map { StepProgress(step: $0) }
  }

  public init(commands: [ExportCommand]) {
    self.init(steps: commands.map(\.step))
  }

  /// Mark a step started. Everything before it is implicitly finished --
  /// steps run in order, and a later one starting is proof the earlier ones
  /// completed, even if their `step-done` event was missed.
  public mutating func start(_ step: ExportStep) {
    guard let index = steps.firstIndex(where: { $0.step == step }) else {
      return
    }

    for earlier in 0..<index where steps[earlier].state != .done {
      steps[earlier].state = .done
    }

    steps[index].state = .running(completed: 0, total: 0)
  }

  public mutating func advance(_ step: ExportStep, completed: Int, total: Int) {
    guard let index = steps.firstIndex(where: { $0.step == step }) else {
      return
    }
    steps[index].state = .running(completed: completed, total: total)
  }

  public mutating func finish(_ step: ExportStep) {
    guard let index = steps.firstIndex(where: { $0.step == step }) else {
      return
    }
    steps[index].state = .done
  }

  public mutating func fail(_ step: ExportStep, _ message: String) {
    guard let index = steps.firstIndex(where: { $0.step == step }) else {
      return
    }

    steps[index].state = .failed(message)
    // Anything after a failure never ran; leaving it "Waiting" would suggest
    // the export is still going.
    for later in (index + 1)..<steps.count {
      steps[later].state = .skipped
    }
  }

  public mutating func finishAll() {
    for index in steps.indices where steps[index].state != .done {
      steps[index].state = .done
    }
  }

  public var currentStep: ExportStep? {
    steps.first { if case .running = $0.state { return true } else { return false } }?
      .step
  }

  /// Overall progress, counting each step as an equal share.
  ///
  /// Steps take wildly different times -- capture is minutes, Markdown is
  /// instant -- so this is a position in the pipeline rather than a time
  /// estimate, and is deliberately not presented as one.
  public var overallFraction: Double {
    guard !steps.isEmpty else { return 0 }

    let completed = steps.reduce(0.0) { total, step in
      switch step.state {
      case .done: total + 1
      case .running: total + (step.fraction ?? 0)
      case .pending, .failed, .skipped: total
      }
    }

    return completed / Double(steps.count)
  }
}
