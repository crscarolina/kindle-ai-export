import KindleExportCore
import SwiftUI

@main
struct KindleExportApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup("Kindle Export") {
      ContentView(model: model)
        .frame(minWidth: 1000, minHeight: 640)
        .task {
          model.loadCachedLibrary()
          model.refreshPreviewState()
          await model.checkRequirements()

          // Setup opens itself only when something is actually missing, so a
          // returning reader is not made to dismiss it every launch.
          if !model.requirements.isComplete {
            model.setupStep = model.requirements.currentStep
            model.showSetup = true
          }

          await model.requestNotificationAuthorization()
          await model.loadVoices()
        }
        .sheet(isPresented: $model.showSetup) {
          SetupWizard(model: model)
        }
    }
    .defaultSize(width: 1180, height: 760)
    .windowStyle(.hiddenTitleBar)
    .commands {
      CommandGroup(after: .appSettings) {
        Button("Setup…") {
          model.setupStep = model.requirements.currentStep
          model.showSetup = true
        }
        .keyboardShortcut("1", modifiers: [.command, .shift])
      }
    }

    Settings {
      SettingsView(model: model)
        .frame(width: 520)
    }
  }
}
