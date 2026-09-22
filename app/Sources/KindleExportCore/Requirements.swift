import Foundation

/// Something the app needs before it can export anything.
public enum Requirement: String, CaseIterable, Sendable {
  case chrome
  case claudeInstalled
  case claudeSignedIn
  case pipeline
  case amazonSession

  public var title: String {
    switch self {
    case .chrome: "Google Chrome"
    case .claudeInstalled: "Claude Code"
    case .claudeSignedIn: "Claude Code sign-in"
    case .pipeline: "Export pipeline"
    case .amazonSession: "Amazon sign-in"
    }
  }

  public var detail: String {
    switch self {
    case .chrome:
      "Pages are captured by driving your own copy of Chrome."
    case .claudeInstalled:
      "The cleanup pass runs through the claude command."
    case .claudeSignedIn:
      "Cleanup uses your Claude subscription, so it needs to be signed in."
    case .pipeline:
      "The scripts that do the work, bundled with the app."
    case .amazonSession:
      "One sign-in in a real Chrome window, two-factor included. Every export after that reuses the profile it leaves behind."
    }
  }

  /// What the reader should do about it, when it is missing.
  public var remedy: String {
    switch self {
    case .chrome: "Download Chrome"
    case .claudeInstalled: "Installation instructions"
    case .claudeSignedIn: "Run claude in a terminal and sign in"
    case .pipeline: "Choose a checkout"
    case .amazonSession: "Sign in to Amazon"
    }
  }

  public var helpURL: URL? {
    switch self {
    case .chrome: URL(string: "https://www.google.com/chrome/")
    case .claudeInstalled: URL(string: "https://claude.com/claude-code")
    default: nil
    }
  }

  /// Which step of setup this belongs to, so a failure can send the reader
  /// back to the place that can fix it.
  public var step: SetupStep {
    switch self {
    case .chrome, .claudeInstalled, .claudeSignedIn, .pipeline: .requirements
    case .amazonSession: .account
    }
  }
}

public enum SetupStep: Int, CaseIterable, Comparable, Sendable {
  case requirements
  case account
  case testRun

  public var title: String {
    switch self {
    case .requirements: "Requirements"
    case .account: "Amazon Account"
    case .testRun: "Test Run"
    }
  }

  public static func < (a: SetupStep, b: SetupStep) -> Bool {
    a.rawValue < b.rawValue
  }
}

/// The state of every requirement.
public struct RequirementsReport: Equatable, Sendable {
  public var satisfied: Set<Requirement>

  public init(satisfied: Set<Requirement> = []) {
    self.satisfied = satisfied
  }

  public func isSatisfied(_ requirement: Requirement) -> Bool {
    satisfied.contains(requirement)
  }

  public var missing: [Requirement] {
    Requirement.allCases.filter { !satisfied.contains($0) }
  }

  public var isComplete: Bool { missing.isEmpty }

  /// Whether a step's own requirements are all met.
  public func isComplete(_ step: SetupStep) -> Bool {
    !missing.contains { $0.step == step }
  }

  /// The step the reader should be on.
  ///
  /// The earliest incomplete one, because the later steps depend on the
  /// earlier: there is no point signing in to Amazon when the browser that
  /// would carry the session is not installed.
  public var currentStep: SetupStep {
    SetupStep.allCases.first { !isComplete($0) } ?? .testRun
  }

  /// Where to send the reader when something fails mid-run.
  ///
  /// A failure often surfaces far from its cause -- an expired Amazon session
  /// shows up as a timeout inside extraction -- so this maps the broken
  /// requirement back to the step that can actually fix it.
  public func step(toFix requirement: Requirement) -> SetupStep {
    requirement.step
  }
}
