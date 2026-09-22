import KindleExportCore
import SwiftUI

/// Walks a new reader through everything the app needs before it can export.
///
/// Three steps, in dependency order: the tools it drives, the account it
/// drives them with, and a test that proves the chain works. A failure in the
/// test sends the reader back to whichever step can fix it, rather than
/// leaving them to guess.
struct SetupWizard: View {
  @Bindable var model: AppModel

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider()

      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          switch model.setupStep {
          case .requirements: RequirementsStep(model: model)
          case .account: AccountStep(model: model)
          case .testRun: TestRunStep(model: model)
          }
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
      }

      Divider()
      footer
    }
    .frame(width: 640, height: 560)
    .task { await model.checkRequirements() }
  }

  private var header: some View {
    HStack(spacing: 0) {
      ForEach(SetupStep.allCases, id: \.self) { step in
        StepChip(
          step: step,
          current: model.setupStep,
          isDone: model.requirements.isComplete(step))

        if step != SetupStep.allCases.last {
          Rectangle()
            .fill(.quaternary)
            .frame(height: 1)
            .frame(maxWidth: 40)
        }
      }
      Spacer()
    }
    .padding(.horizontal, 22)
    .padding(.vertical, 14)
  }

  private var footer: some View {
    HStack {
      Button("Re-check") {
        Task { await model.checkRequirements() }
      }
      .disabled(model.isCheckingRequirements)

      if model.isCheckingRequirements {
        ProgressView().controlSize(.small)
      }

      Spacer()

      if model.setupStep != .requirements {
        Button("Back") {
          model.setupStep =
            SetupStep(rawValue: model.setupStep.rawValue - 1) ?? .requirements
        }
      }

      if model.setupStep == .testRun {
        Button("Done") { model.showSetup = false }
          .buttonStyle(.borderedProminent)
          .disabled(model.testRunOutcome == nil)
      } else {
        Button("Continue") {
          model.setupStep =
            SetupStep(rawValue: model.setupStep.rawValue + 1) ?? .testRun
        }
        .buttonStyle(.borderedProminent)
        .disabled(!model.requirements.isComplete(model.setupStep))
      }
    }
    .padding(.horizontal, 22)
    .padding(.vertical, 14)
  }
}

private struct StepChip: View {
  let step: SetupStep
  let current: SetupStep
  let isDone: Bool

  var body: some View {
    HStack(spacing: 6) {
      ZStack {
        Circle()
          .fill(isDone ? Color.accentColor : (isCurrent ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.14)))
          .frame(width: 20, height: 20)

        if isDone {
          Image(systemName: "checkmark")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white)
        } else {
          Text("\(step.rawValue + 1)")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(isCurrent ? Color.accentColor : .secondary)
        }
      }

      Text(step.title)
        .font(.callout)
        .fontWeight(isCurrent ? .semibold : .regular)
        .foregroundStyle(isCurrent ? .primary : .secondary)
    }
  }

  private var isCurrent: Bool { step == current }
}

/// One requirement, with what to do about it when it is missing.
private struct RequirementRow: View {
  @Bindable var model: AppModel
  let requirement: Requirement

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: isMet ? "checkmark.circle.fill" : "circle")
        .font(.system(size: 16))
        .foregroundStyle(isMet ? Color.green : .secondary)

      VStack(alignment: .leading, spacing: 3) {
        Text(requirement.title).font(.callout).fontWeight(.medium)
        Text(requirement.detail)
          .font(.caption)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer()

      if !isMet {
        action
      }
    }
  }

  @ViewBuilder
  private var action: some View {
    switch requirement {
    case .chrome, .claudeInstalled:
      if let url = requirement.helpURL {
        Link(requirement.remedy, destination: url).font(.callout)
      }
    case .claudeSignedIn:
      Text("Run `claude` in a terminal")
        .font(.caption)
        .foregroundStyle(.secondary)
    case .pipeline:
      Button("Choose…") { chooseRepo() }
    default:
      EmptyView()
    }
  }

  private var isMet: Bool { model.requirements.isSatisfied(requirement) }

  private func chooseRepo() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    if panel.runModal() == .OK, let url = panel.url {
      model.settings.repoPathOverride = url.path(percentEncoded: false)
      Task { await model.checkRequirements() }
    }
  }
}

private struct RequirementsStep: View {
  @Bindable var model: AppModel

  var body: some View {
    Text("What the app needs")
      .font(.title3.weight(.semibold))

    Text(
      "Two programs do work this app cannot do itself: Chrome reads your Kindle library, and Claude Code repairs the text that comes back from OCR."
    )
    .font(.callout)
    .foregroundStyle(.secondary)
    .fixedSize(horizontal: false, vertical: true)

    VStack(spacing: 14) {
      ForEach(
        Requirement.allCases.filter { $0.step == .requirements }, id: \.self
      ) { requirement in
        RequirementRow(model: model, requirement: requirement)
      }
    }
    .padding(.top, 4)
  }
}

private struct AccountStep: View {
  @Bindable var model: AppModel

  var body: some View {
    Text("Your Amazon account")
      .font(.title3.weight(.semibold))

    Text(
      "Chrome opens on the Kindle library and you sign in there, two-factor and all. The app never sees your password: what it keeps is the browser profile, the same thing that keeps you signed in to a site you visit every day."
    )
    .font(.callout)
    .foregroundStyle(.secondary)
    .fixedSize(horizontal: false, vertical: true)

    HStack(spacing: 12) {
      // Prominent until there is a session, plain once there is one: the
      // button stays available for a re-sign-in without still reading as the
      // thing the reader is here to do.
      if signedIn {
        Button("Sign In Again…") { startSignIn() }
          .disabled(model.isBusy)
      } else {
        Button("Sign In with Amazon…") { startSignIn() }
          .buttonStyle(.borderedProminent)
          .disabled(model.isBusy)
      }

      if model.isBusy {
        ProgressView().controlSize(.small)
        Text("Finish in the Chrome window…")
          .font(.callout)
          .foregroundStyle(.secondary)
      } else if signedIn {
        Label("Signed in", systemImage: "checkmark.circle.fill")
          .font(.callout)
          .foregroundStyle(.green)
      }
    }
    .padding(.top, 4)

    if signedIn {
      Text(
        "Sign in again if exports start failing with an expired session, or to switch to a different Amazon account."
      )
      .font(.caption)
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var signedIn: Bool {
    model.requirements.isSatisfied(.amazonSession)
  }

  private func startSignIn() {
    Task {
      await model.signIn()
      await model.checkRequirements()
    }
  }
}

private struct TestRunStep: View {
  @Bindable var model: AppModel

  var body: some View {
    Text("Test run")
      .font(.title3.weight(.semibold))

    Text(
      "This loads your Kindle library, which exercises Chrome, the browser profile and your Amazon session together — the three things most likely to be wrong, and the hardest to check by hand."
    )
    .font(.callout)
    .foregroundStyle(.secondary)
    .fixedSize(horizontal: false, vertical: true)

    HStack(spacing: 12) {
      Button("Run the test") {
        Task { await model.runSetupTest() }
      }
      .buttonStyle(.borderedProminent)
      .disabled(model.isTestRunning)

      if model.isTestRunning {
        ProgressView().controlSize(.small)
        Text("Opening your library…").font(.callout).foregroundStyle(.secondary)
      }
    }

    if let outcome = model.testRunOutcome {
      Label(outcome, systemImage: "checkmark.circle.fill")
        .font(.callout)
        .foregroundStyle(.green)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
