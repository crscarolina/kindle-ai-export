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
          await model.loadVoices()
        }
    }
    .defaultSize(width: 1180, height: 760)
    .windowStyle(.hiddenTitleBar)

    Settings {
      SettingsView(model: model)
        .frame(width: 520)
    }
  }
}
