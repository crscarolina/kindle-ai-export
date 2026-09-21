import KindleExportCore
import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  @State private var password = ""

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
        TextField("Email", text: $model.settings.amazonEmail)
          .onChange(of: model.settings.amazonEmail) { old, new in
            // The Keychain entry is keyed on the email, so carry it across
            // rather than orphaning it when the address is corrected.
            model.settings.moveCredential(from: old, to: new)
          }
        SecureField("Password", text: $password)
          .onChange(of: password) { _, value in
            model.settings.amazonPassword = value
          }
        Text("Stored in your Keychain, and passed to the exporter as an environment variable.")
          .font(.caption)
          .foregroundStyle(.secondary)

        Button("Sign In to Amazon…") { Task { await model.signIn() } }
          .disabled(model.isBusy || !model.settings.isConfigured)
        Text("Opens Chrome so you can sign in once, 2FA included. Exports afterwards run unattended.")
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
    .onAppear { password = model.settings.amazonPassword }
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
