import KindleExportCore
import SwiftUI

struct BookDetail: View {
  @Bindable var model: AppModel

  var body: some View {
    Form {
      if let item = model.selectedItem {
        Section {
          Text(item.title).font(.headline)
          Text(item.authorLine).foregroundStyle(.secondary)
          Text(item.asin)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(.tertiary)
        }

        Section("Formats") {
          Toggle("Markdown", isOn: binding(for: .markdown))
          Toggle("PDF", isOn: binding(for: .pdf))
          Toggle("Audiobook", isOn: binding(for: .audio))

          if model.options.formats.contains(.audio) {
            Text("Narrated locally with Kokoro as an M4B audiobook, with chapters from the table of contents. A full novel takes hours.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }

        if model.options.formats.contains(.audio) {
          Section("Narrator") {
            VoicePicker(model: model)
          }
        }

        Section("Options") {
          Toggle("Clean up transcription with Claude", isOn: $model.options.clean)
          Toggle("Re-run completed steps", isOn: $model.options.force)
          Toggle("Preview first 50 pages only", isOn: previewBinding)
        }

        Section("Destination") {
          HStack {
            Text(model.settings.destination)
              .font(.caption)
              .truncationMode(.head)
              .lineLimit(1)
            Spacer()
            Button("Choose…") { chooseDestination() }
          }
        }

        Section {
          Button {
            model.enqueueSelected()
          } label: {
            Label("Export", systemImage: "square.and.arrow.down")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .disabled(model.options.formats.isEmpty || !model.settings.isConfigured)
        }
      } else {
        ContentUnavailableView(
          "No book selected", systemImage: "book",
          description: Text("Pick a book from your library."))
      }
    }
    .formStyle(.grouped)
  }

  private func binding(for step: ExportStep) -> Binding<Bool> {
    Binding(
      get: { model.options.formats.contains(step) },
      set: { isOn in
        if isOn {
          model.options.formats.insert(step)
        } else {
          model.options.formats.remove(step)
        }
      })
  }

  private var previewBinding: Binding<Bool> {
    Binding(
      get: { model.options.limit != nil },
      set: { model.options.limit = $0 ? 50 : nil })
  }

  private func chooseDestination() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.prompt = "Choose"
    if panel.runModal() == .OK, let url = panel.url {
      model.settings.destination = url.path(percentEncoded: false)
    }
  }
}
