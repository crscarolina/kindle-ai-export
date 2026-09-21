import KindleExportCore
import SwiftUI

struct QueueSidebar: View {
  @Bindable var model: AppModel

  var body: some View {
    List {
      Section("Queue") {
        if model.jobs.isEmpty {
          Text("Nothing queued")
            .font(.callout)
            .foregroundStyle(.secondary)
        }

        ForEach(model.jobs) { job in
          VStack(alignment: .leading, spacing: 4) {
            Text(job.item.title).font(.callout).lineLimit(2)
            Text(job.statusText)
              .font(.caption)
              .foregroundStyle(statusColor(job.state))

            if let progress = job.progress {
              ProgressView(value: progress).controlSize(.small)
            }
          }
          .padding(.vertical, 2)
          .contextMenu {
            Button("Remove", role: .destructive) { model.remove(job) }
          }
        }
      }
    }
    .listStyle(.sidebar)
  }

  private func statusColor(_ state: ExportJob.State) -> Color {
    switch state {
    case .failed: .red
    case .finished: .green
    default: .secondary
    }
  }
}

struct LogDrawer: View {
  @Bindable var model: AppModel

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 1) {
          ForEach(Array(model.log.enumerated()), id: \.offset) { entry in
            Text(entry.element)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
              .id(entry.offset)
          }
        }
        .padding(8)
      }
      .onChange(of: model.log.count) { _, count in
        proxy.scrollTo(count - 1, anchor: .bottom)
      }
    }
    .background(.background.secondary)
  }
}
