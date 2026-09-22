import KindleExportCore
import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel

  var body: some View {
    Form {
      Section("Pipeline") {
        if model.settings.usingBundledRepo {
          Label("Using the copy bundled in the app", systemImage: "shippingbox")
            .font(.callout)
        }

        HStack {
          TextField(
            "Override with a checkout (optional)",
            text: $model.settings.repoPathOverride)
          Button("Choose…") { chooseRepo() }
        }

        if !model.settings.hasNode {
          Label(
            "No node found on PATH. Install Node 20 or later.",
            systemImage: "exclamationmark.triangle")
            .font(.caption)
            .foregroundStyle(.orange)
        } else if !model.settings.repoPath.isEmpty, !model.settings.isConfigured {
          Label(
            "No tsx found there. Run `pnpm install` in the repo.",
            systemImage: "exclamationmark.triangle")
            .font(.caption)
            .foregroundStyle(.orange)
        }
      }

      Section("Amazon") {
        Button("Sign In with Amazon…") { Task { await model.signIn() } }
          .disabled(model.isBusy || !model.settings.isConfigured)
        Text(
          "Opens Chrome so you can sign in once, two-factor included. Exports afterwards reuse the browser profile, so the app never handles your password."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }

      Section("Storage") {
        LabeledContent("Working set", value: model.settings.workDir)
        LabeledContent("Browser profile", value: model.settings.sessionDir)
      }
    }
    .formStyle(.grouped)
    .padding()
  }

  private func chooseRepo() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    if panel.runModal() == .OK, let url = panel.url {
      model.settings.repoPathOverride = url.path(percentEncoded: false)
    }
  }
}
