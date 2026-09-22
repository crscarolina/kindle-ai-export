import AppKit
import KindleExportCore
import SwiftUI

/// Width of the detail pane.
///
/// Fixed rather than draggable so the search field in the top bar can be
/// exactly as wide as the library pane beneath it, the way Finder's toolbar
/// lines up with its columns.
let detailPaneWidth: CGFloat = 380

struct ContentView: View {
  @Bindable var model: AppModel

  var body: some View {
    VStack(spacing: 0) {
      TopBar(model: model)
      Divider()

      if model.needsSignIn {
        SignInBanner(model: model)
      }

      HStack(spacing: 0) {
        LibraryGrid(model: model)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        Divider()
        BookDetail(model: model)
          .frame(width: detailPaneWidth)
      }

      if model.showLog {
        Divider()
        LogDrawer(model: model)
          .frame(height: 180)
      }
    }
    .overlay(alignment: .bottom) {
      if let status = model.status {
        Text(status)
          .font(.callout)
          .padding(.horizontal, 12)
          .padding(.vertical, 6)
          .background(.thinMaterial, in: Capsule())
          .padding(.bottom, 12)
      }
    }
  }
}

struct QueueList: View {
  @Bindable var model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Export Queue").font(.headline)
        Spacer()
        if model.jobs.contains(where: { $0.isFinished }) {
          Button("Clear Finished") { model.clearFinishedJobs() }
            .buttonStyle(.link)
            .font(.caption)
        }
      }
      .padding(12)

      Divider()

      if model.jobs.isEmpty {
        Text("Nothing queued")
          .font(.callout)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .center)
          .padding(.vertical, 28)
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 10) {
            ForEach(model.jobs) { job in
              VStack(alignment: .leading, spacing: 4) {
                Text(job.item.title).font(.callout).lineLimit(2)
                HStack(spacing: 8) {
                  Text(job.statusText)
                    .font(.caption)
                    .foregroundStyle(statusColor(job.state))
                  Spacer()
                  Button("Remove", role: .destructive) { model.remove(job) }
                    .buttonStyle(.link)
                    .font(.caption)
                }
                if !job.timeline.steps.isEmpty {
                  JobTimelineView(timeline: job.timeline, compact: true)
                    .padding(.top, 2)
                }
              }
            }
          }
          .padding(12)
        }
      }
    }
    .frame(width: 340)
    .frame(maxHeight: 420)
  }

  private func statusColor(_ state: ExportJob.State) -> Color {
    switch state {
    case .failed: .red
    case .finished: .green
    default: .secondary
    }
  }
}

/// Amazon's session has lapsed. The pipeline can't answer a 2FA prompt, so the
/// queue pauses here rather than failing every remaining book.
struct SignInBanner: View {
  @Bindable var model: AppModel

  var body: some View {
    HStack {
      Image(systemName: "exclamationmark.triangle.fill")
        .foregroundStyle(.orange)
      Text("Amazon session expired — the queue is paused.")
      Spacer()
      Button("Fix This") { model.returnToSetup(toFix: .amazonSession) }
        .disabled(model.isBusy)
    }
    .padding(10)
    .background(.orange.opacity(0.12))
  }
}

struct LibraryGrid: View {
  @Bindable var model: AppModel

  private let columns = [GridItem(.adaptive(minimum: 132), spacing: 18)]

  var body: some View {
    ScrollView {
      if model.filteredLibrary.isEmpty {
        ContentUnavailableView(
          "No books",
          systemImage: "books.vertical",
          description: Text("Refresh to load your Kindle library.")
        )
        .padding(.top, 80)
      } else {
        LazyVGrid(columns: columns, spacing: 20) {
          // The paging trigger hangs off the cells themselves, not off a
          // footer below the grid. Only the grid is lazy: anything outside it
          // is built as soon as the scroll view appears, so a footer sentinel
          // fired once immediately and then never again -- it kept its view
          // identity as the grid grew past it, and SwiftUI calls `onAppear`
          // once per identity. A cell is created by `LazyVGrid` only when the
          // reader scrolls near it, and each page brings new cells with new
          // identities, so the trigger keeps firing until nothing is left.
          ForEach(Array(model.visibleLibrary.enumerated()), id: \.element.id) {
            index, item in
            BookCell(item: item, isSelected: item.asin == model.selectedAsin)
              .onTapGesture { model.selectedAsin = item.asin }
              .onAppear { model.cellAppeared(at: index) }
          }
        }
        .padding(18)

        if model.hasMoreToShow {
          // No spinner: widening the window is a larger `prefix` of an array
          // already in memory. A spinner here would promise a load that never
          // arrives, which is what made a stalled grid look like a hung one.
          Text("\(model.remainingToShow) more")
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
        } else if model.filteredLibrary.count > AppModel.pageSize {
          Text("\(model.filteredLibrary.count) books")
            .font(.caption)
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
        }
      }
    }
  }
}

struct BookCell: View {
  let item: Book
  let isSelected: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ZStack {
        RoundedRectangle(cornerRadius: 6).fill(.quaternary)
        if let cover = item.coverUrl, let url = URL(string: cover) {
          AsyncImage(url: url) { image in
            image.resizable().aspectRatio(contentMode: .fit)
          } placeholder: {
            ProgressView().controlSize(.small)
          }
        }
      }
      .frame(height: 186)
      .clipShape(RoundedRectangle(cornerRadius: 6))
      .overlay {
        RoundedRectangle(cornerRadius: 6)
          .strokeBorder(isSelected ? Color.accentColor : .clear, lineWidth: 3)
      }

      Text(item.title).font(.caption).lineLimit(2)
      Text(item.authorLine)
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}

/// The pipeline's output, tailed like `tail -f`.
///
/// Opens on the newest lines and keeps them in view, but stops following the
/// moment the reader scrolls back, so reading earlier output during a run is
/// not interrupted by every line that arrives.
struct LogDrawer: View {
  @Bindable var model: AppModel

  @State private var isFollowing = true
  /// How long the log was when following stopped, so the badge can say how
  /// much has arrived out of sight since.
  @State private var pausedAtCount = 0
  /// Geometry from the first layout passes arrives before the scroll view has
  /// settled on its bottom anchor, and acting on it would drop out of
  /// following before the reader has touched anything.
  @State private var hasSettled = false
  /// Identifies the most recent copy, so the confirmation on the button can
  /// time out -- and a second copy can restart that timer -- without the view
  /// owning a timer of its own.
  @State private var lastCopy: UUID?

  private let scrollSpace = "log"

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Log").font(.caption).foregroundStyle(.secondary)
        Text("\(model.log.count)")
          .font(.caption2)
          .foregroundStyle(.tertiary)
        Spacer()
        Button(lastCopy == nil ? "Copy" : "Copied") { copyWholeLog() }
          .buttonStyle(.link)
          .font(.caption)
          .disabled(model.log.isEmpty)
          // "Copied" is the wider word, so reserving its width keeps the
          // neighbouring buttons from shuffling sideways for a second.
          .frame(minWidth: 44)
          .help("Copy every line of the log to the clipboard")
          .task(id: lastCopy) {
            guard lastCopy != nil else { return }
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            lastCopy = nil
          }
        Button("Clear") { model.clearLog() }
          .buttonStyle(.link)
          .font(.caption)
          .disabled(model.log.isEmpty)
        Button {
          model.showLog = false
        } label: {
          Image(systemName: "xmark")
        }
        .buttonStyle(.plain)
        .help("Hide the log")
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 5)

      Divider()

      ScrollViewReader { proxy in
        GeometryReader { viewport in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 1) {
              ForEach(Array(model.log.enumerated()), id: \.offset) { entry in
                // Each line is its own view, so `.textSelection` here would
                // only ever select within one of them: dragging across lines
                // silently keeps just the last one, and rows the lazy stack
                // has discarded cannot be in a selection at all. Copying via
                // the header button or this menu is the honest route.
                Text(entry.element)
                  .font(.system(.caption, design: .monospaced))
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .contextMenu {
                    Button("Copy Line") { copy(entry.element) }
                    Button("Copy Whole Log") { copyWholeLog() }
                  }
                  .id(entry.offset)
              }
            }
            .padding(8)
            .background { measure(viewport: viewport.size.height) }
          }
          .coordinateSpace(.named(scrollSpace))
          // The bottom anchor puts the newest lines on screen in the very
          // first frame, with none of the visible travel an onAppear scroll
          // would show. Dropping it while paused stops appended lines from
          // shifting what the reader is looking at.
          .defaultScrollAnchor(isFollowing ? UnitPoint.bottom : nil)
          .onChange(of: model.log.count) { _, count in
            if count == 0 {
              // Clearing the log -- which every run does as it starts --
              // leaves the panel following again.
              isFollowing = true
              pausedAtCount = 0
            } else if isFollowing {
              proxy.scrollTo(count - 1, anchor: .bottom)
            }
          }
          .overlay(alignment: .bottomTrailing) { jumpToBottom(proxy) }
          .task {
            try? await Task.sleep(for: .milliseconds(200))
            hasSettled = true
          }
        }
      }
    }
    .background(.background.secondary)
  }

  private func copyWholeLog() {
    copy(LogClipboard.text(for: model.log))
    lastCopy = UUID()
  }

  private func copy(_ text: String) {
    guard !text.isEmpty else { return }
    // The pasteboard serves whatever its last owner wrote until the contents
    // are cleared, so the clear has to come first or the write is dropped.
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }

  /// Reports where the content sits inside the scroll view as it moves.
  private func measure(viewport: CGFloat) -> some View {
    GeometryReader { content in
      let metrics = ScrollMetrics(
        offset: -content.frame(in: .named(scrollSpace)).minY,
        contentHeight: content.size.height,
        viewportHeight: viewport)

      Color.clear.onChange(of: metrics) { _, moved in
        follow(ifAtBottom: moved)
      }
    }
  }

  private func follow(ifAtBottom metrics: ScrollMetrics) {
    guard hasSettled else { return }

    let atBottom = metrics.isAtBottom()
    guard atBottom != isFollowing else { return }

    isFollowing = atBottom
    if !atBottom { pausedAtCount = model.log.count }
  }

  private var linesBelow: Int {
    max(0, model.log.count - pausedAtCount)
  }

  @ViewBuilder
  private func jumpToBottom(_ proxy: ScrollViewProxy) -> some View {
    if !isFollowing, !model.log.isEmpty {
      Button {
        isFollowing = true
        proxy.scrollTo(model.log.count - 1, anchor: .bottom)
      } label: {
        HStack(spacing: 4) {
          Image(systemName: "arrow.down")
          Text(linesBelow > 0 ? "\(linesBelow) new" : "Latest")
        }
        .font(.caption)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.thinMaterial, in: Capsule())
      }
      .buttonStyle(.plain)
      .help("Jump to the end of the log")
      .padding(8)
    }
  }
}
