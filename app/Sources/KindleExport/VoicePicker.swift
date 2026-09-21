import AVFoundation
import KindleExportCore
import SwiftUI

/// Forwards `AVAudioPlayer`'s delegate callbacks, which arrive on an audio
/// thread, back to the main actor.
///
/// `AVAudioPlayer.delegate` is a weak reference, so this has to be owned by
/// `PreviewPlayer`; an observer created inline would be deallocated before the
/// clip ever finished and the callback would never arrive.
private final class PreviewPlaybackObserver: NSObject, AVAudioPlayerDelegate {
  private let onEnd: @Sendable () -> Void

  init(onEnd: @escaping @Sendable () -> Void) {
    self.onEnd = onEnd
  }

  func audioPlayerDidFinishPlaying(
    _ player: AVAudioPlayer, successfully flag: Bool
  ) {
    onEnd()
  }

  /// A clip that fails to decode never reports finishing, so treat it as an
  /// ending too rather than leaving the button stuck on "Stop".
  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    onEnd()
  }
}

/// Plays a voice audition clip.
///
/// One player for the whole picker, so starting a new preview stops the one
/// already running rather than layering two narrators over each other.
@Observable
@MainActor
final class PreviewPlayer {
  private var player: AVAudioPlayer?
  private var observer: PreviewPlaybackObserver?

  /// Identifies the current playback. A callback hops to the main actor
  /// asynchronously, so one from a clip that has since been stopped or
  /// replaced can land after a newer clip started; without this it would clear
  /// the newer clip's state.
  private var generation = 0

  private(set) var playingVoiceId: String?

  func toggle(voiceId: String, url: URL) {
    if playingVoiceId == voiceId {
      stop()
      return
    }

    stop()
    do {
      let player = try AVAudioPlayer(contentsOf: url)
      let generation = self.generation
      let observer = PreviewPlaybackObserver { [weak self] in
        Task { @MainActor in self?.playbackEnded(generation: generation) }
      }
      player.delegate = observer
      player.prepareToPlay()
      player.play()
      self.player = player
      self.observer = observer
      playingVoiceId = voiceId
    } catch {
      stop()
    }
  }

  func stop() {
    // Bumping first invalidates any callback still in flight from the clip
    // being torn down here.
    generation += 1
    player?.delegate = nil
    player?.stop()
    player = nil
    observer = nil
    playingVoiceId = nil
  }

  private func playbackEnded(generation: Int) {
    guard generation == self.generation else { return }
    stop()
  }
}

struct VoicePicker: View {
  @Bindable var model: AppModel
  @State private var player = PreviewPlayer()

  var body: some View {
    Picker("Voice", selection: $model.options.voice) {
      ForEach(sortedVoices) { voice in
        Text("\(voice.label) — \(voice.summary)").tag(voice.id)
      }
    }
    .onChange(of: model.options.voice) { _, _ in player.stop() }

    if let voice = model.selectedVoice {
      VStack(alignment: .leading, spacing: 8) {
        Text(voice.description)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)

        HStack {
          Text("Pace")
          Spacer()
          Picker("Pace", selection: $model.options.speed) {
            ForEach(Self.paces, id: \.self) { pace in
              Text(Self.label(for: pace)).tag(pace)
            }
          }
          .labelsHidden()
          .pickerStyle(.menu)
          .frame(width: 150)
        }
        .font(.callout)

        HStack(spacing: 8) {
          if voice.longForm {
            Label("Holds up over a full book", systemImage: "checkmark.seal")
              .font(.caption)
              .foregroundStyle(.green)
          }

          Spacer()

          if let preview = model.selectedVoicePreview {
            Button {
              player.toggle(voiceId: voice.id, url: preview)
            } label: {
              Label(
                player.playingVoiceId == voice.id ? "Stop" : "Preview",
                systemImage: player.playingVoiceId == voice.id
                  ? "stop.fill" : "play.fill")
            }
          } else {
            Text("No preview rendered")
              .font(.caption)
              .foregroundStyle(.tertiary)
              .help(
                "Run src/render-voice-previews.ts to generate audition clips.")
          }
        }

        if model.selectedVoicePreview != nil, !model.previewMatchesPace {
          // Say so rather than letting a natural-pace clip stand in silently
          // for a pace the reader has actually chosen.
          Text("Preview is at the natural pace, not the one selected.")
            .font(.caption)
            .foregroundStyle(.orange)
        }
      }
      .padding(.vertical, 2)
    }
  }

  /// Paces worth offering. Beyond this range Kokoro stops sounding like
  /// speech, and the CLI rejects it outright.
  static let paces: [Double] = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.25]

  static func label(for pace: Double) -> String {
    let percent = Int((pace * 100).rounded())
    if pace == 1 { return "Natural (100%)" }
    return pace < 1 ? "Slower (\(percent)%)" : "Faster (\(percent)%)"
  }

  /// Long-form voices first, then by Kokoro's grade.
  private var sortedVoices: [VoiceOption] {
    model.voices.sorted { a, b in
      if a.longForm != b.longForm { return a.longForm }
      return gradeRank(a.grade) < gradeRank(b.grade)
    }
  }

  private func gradeRank(_ grade: String) -> Int {
    let order = [
      "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F+", "F",
    ]
    return order.firstIndex(of: grade) ?? order.count
  }
}
