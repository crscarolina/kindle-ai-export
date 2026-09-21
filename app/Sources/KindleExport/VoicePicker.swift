import AVFoundation
import KindleExportCore
import SwiftUI

/// Plays a voice audition clip.
///
/// One player for the whole picker, so starting a new preview stops the one
/// already running rather than layering two narrators over each other.
@Observable
@MainActor
final class PreviewPlayer {
  private var player: AVAudioPlayer?
  private(set) var playingVoiceId: String?

  func toggle(voiceId: String, url: URL) {
    if playingVoiceId == voiceId {
      stop()
      return
    }

    stop()
    do {
      let player = try AVAudioPlayer(contentsOf: url)
      player.prepareToPlay()
      player.play()
      self.player = player
      playingVoiceId = voiceId
    } catch {
      playingVoiceId = nil
    }
  }

  func stop() {
    player?.stop()
    player = nil
    playingVoiceId = nil
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
      }
      .padding(.vertical, 2)
    }
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
