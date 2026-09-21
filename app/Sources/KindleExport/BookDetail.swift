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
          .disabled(
            model.options.formats.isEmpty || !model.settings.isConfigured
              || isExporting)

          if let job = currentJob {
            VStack(alignment: .leading, spacing: 10) {
              Text(statusText(for: job))
                .font(.caption)
                .foregroundStyle(statusColor(job.state))

              // Empty until the job starts, because what runs depends on
              // what is already on disk.
              if !job.timeline.steps.isEmpty {
                JobTimelineView(timeline: job.timeline)
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
      } else {
        ContentUnavailableView(
          "No book selected", systemImage: "book",
          description: Text("Pick a book from your library."))
      }
    }
    .formStyle(.grouped)
  }

  // MARK: - Export status

  /// The queue entry this pane reports on.
  ///
  /// A book can be enqueued more than once. The newest job that hasn't ended
  /// is the one the reader is waiting on; when every job for the book has
  /// ended, the newest of those stays on screen so its outcome is still
  /// readable.
  private var currentJob: ExportJob? {
    guard let asin = model.selectedItem?.asin else { return nil }
    let mine = model.jobs.filter { $0.item.asin == asin }
    return mine.last { !$0.isFinished } ?? mine.last
  }

  /// Whether the selected book is spoken for, so it can't be enqueued twice.
  private var isExporting: Bool {
    currentJob.map { !$0.isFinished } ?? false
  }

  /// Where this job sits among the books still waiting.
  ///
  /// Both halves count queued jobs only. A denominator of every job would go
  /// on counting books that have already been exported, so the ratio would
  /// never shrink as the queue drains.
  private var queuePosition: (position: Int, total: Int)? {
    guard let job = currentJob, job.state == .queued else { return nil }
    let queued = model.jobs.filter { $0.state == .queued }
    guard let index = queued.firstIndex(where: { $0.id == job.id }) else {
      return nil
    }
    return (index + 1, queued.count)
  }

  private func statusText(for job: ExportJob) -> String {
    guard let place = queuePosition else { return job.statusText }
    return "Enqueued \(place.position)/\(place.total)"
  }

  private func statusColor(_ state: ExportJob.State) -> Color {
    switch state {
    case .failed: .red
    case .finished: .green
    default: .secondary
    }
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
