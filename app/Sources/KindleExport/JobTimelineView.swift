import KindleExportCore
import SwiftUI

/// The steps of an export, drawn as a vertical timeline.
///
/// A single bar could only ever show one step at a time, which left the
/// reader unable to see what an export involves, what it has already done, or
/// what is still to come.
struct JobTimelineView: View {
  let timeline: JobTimeline
  /// Compact form for the queue popover, where space is tight.
  var compact = false

  var body: some View {
    VStack(alignment: .leading, spacing: compact ? 6 : 10) {
      ForEach(Array(timeline.steps.enumerated()), id: \.element.id) { entry in
        StepRow(
          progress: entry.element,
          isLast: entry.offset == timeline.steps.count - 1,
          compact: compact)
      }
    }
  }
}

private struct StepRow: View {
  let progress: StepProgress
  let isLast: Bool
  let compact: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      // The rail: a marker per step, joined by a line so the steps read as
      // one sequence rather than a list of unrelated rows.
      VStack(spacing: 0) {
        marker
        if !isLast {
          Rectangle()
            .fill(isComplete ? Color.accentColor.opacity(0.5) : Color.secondary.opacity(0.22))
            .frame(width: 2)
            .frame(maxHeight: .infinity)
        }
      }
      .frame(width: 18)

      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(progress.step.displayName)
            .font(compact ? .caption : .callout)
            .fontWeight(isRunning ? .semibold : .regular)
            .foregroundStyle(titleColor)

          Spacer()

          Text(progress.detailText)
            .font(.caption2)
            .foregroundStyle(detailColor)
            .lineLimit(1)
            .truncationMode(.tail)
        }

        if let fraction = progress.fraction, isRunning {
          ProgressView(value: fraction)
            .controlSize(.small)
        } else if isRunning {
          // Started, but no total yet -- an indeterminate bar is honest here,
          // where a bar pinned at zero would read as stalled.
          ProgressView()
            .progressViewStyle(.linear)
            .controlSize(.small)
        }
      }
      .padding(.bottom, isLast ? 0 : (compact ? 2 : 4))
    }
    .frame(minHeight: compact ? 22 : 28, alignment: .top)
  }

  private var marker: some View {
    ZStack {
      Circle()
        .fill(markerFill)
        .frame(width: 18, height: 18)

      switch progress.state {
      case .done:
        Image(systemName: "checkmark")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(.white)
      case .failed:
        Image(systemName: "xmark")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(.white)
      case .running:
        Image(systemName: progress.step.symbolName)
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(.white)
      case .skipped:
        Image(systemName: "minus")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(.secondary)
      case .pending:
        Circle()
          .fill(.secondary.opacity(0.4))
          .frame(width: 5, height: 5)
      }
    }
  }

  private var markerFill: Color {
    switch progress.state {
    case .done: .accentColor
    case .running: .accentColor
    case .failed: .red
    case .pending, .skipped: .secondary.opacity(0.16)
    }
  }

  private var titleColor: Color {
    switch progress.state {
    case .pending, .skipped: .secondary
    case .failed: .red
    case .done, .running: .primary
    }
  }

  private var detailColor: Color {
    switch progress.state {
    case .failed: .red
    case .done: .secondary
    default: .secondary.opacity(0.75)
    }
  }

  private var isRunning: Bool {
    if case .running = progress.state { return true }
    return false
  }

  private var isComplete: Bool {
    progress.state == .done
  }
}
