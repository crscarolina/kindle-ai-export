import KindleExportCore
import SwiftUI

/// The surface a floating toolbar group is drawn on.
///
/// A material reads grey over the `.bar` background, whereas the real Tahoe
/// pills read as a control surface: opaque white in light appearance, and a
/// translucent white wash in dark appearance that sits above the bar rather
/// than sinking into it. `controlColor` is exactly that pair.
private let pillFill = Color(nsColor: .controlColor)

/// The fill behind one toolbar icon, covering both selection and hover.
///
/// Hover belongs on the icon rather than on the capsule: Finder highlights the
/// single view-mode icon under the pointer, not the whole group.
private struct ToolbarIconHighlight: ViewModifier {
  var isOn: Bool
  var disabled: Bool
  @State private var isHovering = false

  /// Derived from the label colour, so the wash darkens the icon in light
  /// appearance and lightens it in dark appearance. A hovered selection goes
  /// one step further so it stays distinct from both plain states.
  private var fillOpacity: Double {
    switch (isOn, isHovering && !disabled) {
    case (true, true): 0.16
    case (true, false): 0.10
    case (false, true): 0.06
    case (false, false): 0
    }
  }

  func body(content: Content) -> some View {
    content
      .background(Color.primary.opacity(fillOpacity), in: RoundedRectangle(cornerRadius: 7))
      .contentShape(RoundedRectangle(cornerRadius: 7))
      .onHover { isHovering = $0 }
      .animation(.easeOut(duration: 0.12), value: fillOpacity)
  }
}

extension View {
  /// Gives a toolbar control the capsule's selection and hover feedback.
  func toolbarIconHighlight(isOn: Bool = false, disabled: Bool = false) -> some View {
    modifier(ToolbarIconHighlight(isOn: isOn, disabled: disabled))
  }
}

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
    .background(pillFill, in: Capsule())
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
        .toolbarIconHighlight(isOn: isOn, disabled: disabled)
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
            .toolbarIconHighlight()
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
    .background(pillFill, in: Capsule())
    .overlay(Capsule().strokeBorder(.quaternary, lineWidth: 0.5))
    .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
  }
}
