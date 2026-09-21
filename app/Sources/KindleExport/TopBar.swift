import KindleExportCore
import SwiftUI

/// A floating capsule that groups related controls, as in the macOS 26
/// Finder toolbar.
struct ToolbarCapsule<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    HStack(spacing: 2) {
      content
    }
    .padding(.horizontal, 6)
    .padding(.vertical, 5)
    .background(.regularMaterial, in: Capsule())
    .overlay(Capsule().strokeBorder(.quaternary, lineWidth: 0.5))
    .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
  }
}

/// One icon inside a capsule group, with an optional selected state.
struct ToolbarIconButton: View {
  let symbol: String
  var isOn = false
  var help: String = ""
  var disabled = false
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 15, weight: .medium))
        .frame(width: 30, height: 24)
        .background(
          isOn ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear),
          in: RoundedRectangle(cornerRadius: 7)
        )
        .contentShape(RoundedRectangle(cornerRadius: 7))
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .opacity(disabled ? 0.4 : 1)
    .help(help)
  }
}

/// A thin separator between icons inside one capsule.
struct ToolbarGroupDivider: View {
  var body: some View {
    Rectangle()
      .fill(.quaternary)
      .frame(width: 1, height: 16)
      .padding(.horizontal, 3)
  }
}

/// Space the window's close/minimise/zoom buttons occupy.
///
/// The title bar is hidden so the strip reads as one bar, which means the
/// system draws its buttons inside it.
private let trafficLightInset: CGFloat = 80

/// The window's top strip.
///
/// The search field is centred on the library pane beneath it, inset equally
/// on both sides so it clears the window buttons and stays centred. The
/// control capsules sit over the detail pane, with the queue furthest right.
struct TopBar: View {
  @Bindable var model: AppModel
  @State private var showQueue = false

  var body: some View {
    HStack(spacing: 10) {
      searchField
        .padding(.horizontal, trafficLightInset)
        .frame(maxWidth: .infinity)

      HStack(spacing: 8) {
        Spacer(minLength: 0)

        ToolbarCapsule {
          ToolbarIconButton(
            symbol: "arrow.clockwise",
            help: "Reload your Kindle library",
            disabled: model.isBusy
          ) {
            Task { await model.refreshLibrary() }
          }

          ToolbarGroupDivider()

          ToolbarIconButton(
            symbol: "list.bullet.rectangle",
            isOn: model.showLog,
            help: model.showLog ? "Hide the log" : "Show the log"
          ) {
            model.showLog.toggle()
          }
        }

        ToolbarCapsule {
          Button {
            showQueue.toggle()
          } label: {
            HStack(spacing: 5) {
              Image(systemName: "tray.full")
                .font(.system(size: 15, weight: .medium))
              if !model.jobs.isEmpty {
                Text("\(model.jobs.count)")
                  .font(.caption2.monospacedDigit().weight(.semibold))
                  .foregroundStyle(.white)
                  .padding(.horizontal, 5)
                  .padding(.vertical, 1)
                  .background(Color.accentColor, in: Capsule())
              }
            }
            .frame(height: 24)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .help("Export queue")
          .popover(isPresented: $showQueue, arrowEdge: .bottom) {
            QueueList(model: model)
          }
        }
      }
      .padding(.trailing, 14)
      .frame(width: detailPaneWidth)
    }
    .frame(height: 56)
    .background(.bar)
  }

  private var searchField: some View {
    HStack(spacing: 7) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.secondary)

      TextField("Search library", text: $model.search)
        .textFieldStyle(.plain)
        .font(.system(size: 13))

      if !model.search.isEmpty {
        Button {
          model.search = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tertiary)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(.regularMaterial, in: Capsule())
    .overlay(Capsule().strokeBorder(.quaternary, lineWidth: 0.5))
    .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
  }
}
