import Foundation
import KindleExportCore

/// Gathers events from the runner's callback, which fires off the main thread.
final class Collector: @unchecked Sendable {
  private let lock = NSLock()
  private var stored: [ExportEvent] = []
  func add(_ event: ExportEvent) { lock.withLock { stored.append(event) } }
  var events: [ExportEvent] { lock.withLock { stored } }
}

var t = TestHarness()

// MARK: - ExportEvent decoding
//
// Mirrors `src/lib/events.test.ts`; the two decoders must agree or the app's
// progress reporting silently stops matching what the scripts emit.

t.expectEqual(
  ExportEvent.decode(line: #"{"event":"step-start","step":"extract"}"#),
  .stepStart(.extractBook), "decodes step-start")

t.expectEqual(
  ExportEvent.decode(line: #"{"event":"step-done","step":"transcribe"}"#),
  .stepDone(.transcribe), "decodes step-done")

t.expectEqual(
  ExportEvent.decode(line: #"{"event":"page","index":12,"page":9,"total":380}"#),
  .page(index: 12, page: 9, total: 380), "decodes page progress")

t.expectEqual(
  ExportEvent.decode(line: #"{"event":"session-expired"}"#),
  .sessionExpired, "decodes session-expired")

t.expectEqual(
  ExportEvent.decode(
    line: #"{"event":"book-meta","asin":"B0819W19WD","title":"X","authors":["A"]}"#),
  .bookMeta(asin: "B0819W19WD", title: "X", authors: ["A"]), "decodes book-meta")

t.expectEqual(
  ExportEvent.decode(line: #"{"event":"done","outFile":"/tmp/b.md"}"#),
  .done(outFile: "/tmp/b.md"), "decodes done with an out file")

t.expectEqual(
  ExportEvent.decode(line: #"{"event":"done"}"#),
  .done(outFile: nil), "decodes done without an out file")

t.expectEqual(
  ExportEvent.decode(line: "{\"event\":\"session-expired\"}\n"),
  .sessionExpired, "decodes a line with a trailing newline")

t.expectEqual(
  ExportEvent.decode(line: #"{"event":"error","message":"first\nsecond"}"#),
  .error("first\nsecond"), "preserves embedded newlines in a message")

// The scripts still log prose, and npm writes warnings of its own, so the
// decoder has to shrug these off rather than treat them as failures.
for line in [
  "Looking for Reader settings button",
  "npm warn Unknown project config",
  "",
  "   \n",
  "[1,2,3]",
  #"{"page":3}"#,
  #"{"event":"who-knows"}"#,
  #"{"event":"page","index":1}"#,
  #"{"event":"step-start","step":"nope"}"#,
] {
  t.expect(
    ExportEvent.decode(line: line) == nil,
    "ignores non-event output: \(line.debugDescription)")
}

// MARK: - LineBuffer

func lines(_ chunks: [String]) -> [String] {
  var buffer = LineBuffer()
  var out: [String] = []
  for chunk in chunks {
    out += buffer.append(Data(chunk.utf8))
  }
  if let tail = buffer.flush() { out.append(tail) }
  return out
}

t.expectEqual(lines(["one\n"]), ["one"], "yields a complete line")

t.expectEqual(
  lines(["one\ntwo\n"]), ["one", "two"], "splits two lines in one chunk")

// The case that matters: an event straddling a pipe read.
t.expectEqual(
  lines([#"{"event":"pa"#, #"ge","index":1}"# + "\n"]),
  [#"{"event":"page","index":1}"#],
  "reassembles a line split across chunks")

t.expectEqual(
  lines(["a\nb", "c\n"]), ["a", "bc"], "joins a tail to the next chunk")

t.expectEqual(lines(["no newline"]), ["no newline"], "flushes a trailing partial line")

t.expectEqual(lines([]), [], "yields nothing for no input")

t.expectEqual(lines([""]), [], "yields nothing for an empty chunk")

t.expectEqual(lines(["\n"]), [""], "yields an empty line for a bare newline")

t.expectEqual(lines(["a\r\nb\r\n"]), ["a", "b"], "strips carriage returns")

t.expectEqual(
  lines(["one\n", "two\n", "three"]), ["one", "two", "three"],
  "handles many chunks")

var held = LineBuffer()
t.expectEqual(
  held.append(Data("partial".utf8)), [],
  "withholds a line until its newline arrives")
t.expectEqual(
  held.append(Data("-rest\n".utf8)), ["partial-rest"],
  "emits the line once the newline arrives")

// MARK: - ExportCommand

let base = ExportCommand(
  step: .extractBook, asin: "B0819W19WD",
  workDir: "/work", userDataDir: "/session")

t.expectEqual(base.scriptPath, "src/extract-kindle-book.ts", "maps extract to its script")
t.expectEqual(
  ExportCommand(step: .transcribe, asin: "A", workDir: "/w", userDataDir: "/s").scriptPath,
  "src/transcribe-book-content.ts", "maps transcribe to its script")
t.expectEqual(
  ExportCommand(step: .markdown, asin: "A", workDir: "/w", userDataDir: "/s").scriptPath,
  "src/export-book-markdown.ts", "maps markdown to its script")
t.expectEqual(
  ExportCommand(step: .clean, asin: "A", workDir: "/w", userDataDir: "/s").scriptPath,
  "src/clean-transcription.ts", "maps cleanup to its script")
// Narration goes through the local Kokoro script, not the cloud TTS one.
t.expectEqual(
  ExportCommand(step: .audio, asin: "A", workDir: "/w", userDataDir: "/s").scriptPath,
  "src/narrate-book.ts", "maps audio to the local narration script")

t.expectEqual(
  base.arguments,
  ["--asin", "B0819W19WD", "--work-dir", "/work", "--user-data-dir", "/session", "--json"],
  "passes every path explicitly")

// Every invocation must request NDJSON, or the app sees only prose.
for step in ExportStep.allCases {
  let command = ExportCommand(step: step, asin: "A", workDir: "/w", userDataDir: "/s")
  t.expect(command.arguments.contains("--json"), "\(step.rawValue) requests json output")
}

t.expectEqual(
  ExportCommand(
    step: .markdown, asin: "A", workDir: "/w", userDataDir: "/s",
    outFile: "/books/b.md"
  ).arguments.suffix(2).map { $0 },
  ["--out-file", "/books/b.md"], "appends the chosen destination")

t.expectEqual(
  ExportCommand(
    step: .transcribe, asin: "A", workDir: "/w", userDataDir: "/s", limit: 50
  ).arguments.suffix(2).map { $0 },
  ["--limit", "50"], "appends a page limit")

t.expect(
  ExportCommand(
    step: .extractBook, asin: "A", workDir: "/w", userDataDir: "/s", force: true
  ).arguments.contains("--force"), "appends force")

t.expect(
  !base.arguments.contains("--force"), "omits force by default")
t.expect(
  !base.arguments.contains("--limit"), "omits limit by default")
t.expect(
  !base.arguments.contains("--out-file"), "omits out-file by default")

// MARK: - Voice selection

t.expect(
  ExportCommand(
    step: .audio, asin: "A", workDir: "/w", userDataDir: "/s", voice: "bm_george"
  ).arguments.contains("--voice"),
  "narration is given a voice")

t.expectEqual(
  ExportCommand(
    step: .audio, asin: "A", workDir: "/w", userDataDir: "/s", voice: "bm_george"
  ).arguments.suffix(2).map { $0 },
  ["--voice", "bm_george"], "the chosen voice is passed through")

// Only the narration step understands the flag; the others would reject it.
for step in ExportStep.allCases where step != .audio {
  t.expect(
    !ExportCommand(
      step: step, asin: "A", workDir: "/w", userDataDir: "/s", voice: "bm_george"
    ).arguments.contains("--voice"),
    "\(step.rawValue) is not given a voice")
}

t.expect(
  !ExportCommand(step: .audio, asin: "A", workDir: "/w", userDataDir: "/s")
    .arguments.contains("--voice"),
  "no voice flag when none was chosen")

t.expectEqual(
  ExportPlan.commands(
    asin: "B1", options: ExportOptions(formats: [.audio], voice: "af_bella"),
    state: BookState(), workDir: "/w", userDataDir: "/s", destination: nil
  ).first(where: { $0.step == .audio })?.voice,
  "af_bella", "the plan carries the chosen voice to narration")

t.expectEqual(
  ExportOptions().voice, "af_heart", "the flagship voice is the default")

// MARK: - Narration pace

t.expect(
  !ExportCommand(step: .audio, asin: "A", workDir: "/w", userDataDir: "/s", speed: 1)
    .arguments.contains("--speed"),
  "the natural pace is left implicit")

t.expectEqual(
  ExportCommand(
    step: .audio, asin: "A", workDir: "/w", userDataDir: "/s", speed: 0.9
  ).arguments.suffix(2).map { $0 },
  ["--speed", "0.9"], "a slower pace is passed through")

t.expectEqual(
  ExportCommand(
    step: .audio, asin: "A", workDir: "/w", userDataDir: "/s", speed: 1.25
  ).arguments.suffix(2).map { $0 },
  ["--speed", "1.25"], "a faster pace is passed through")

// Only narration understands a pace; the other steps would reject it.
for step in ExportStep.allCases where step != .audio {
  t.expect(
    !ExportCommand(
      step: step, asin: "A", workDir: "/w", userDataDir: "/s", speed: 0.9
    ).arguments.contains("--speed"),
    "\(step.rawValue) is not given a pace")
}

t.expectEqual(ExportCommand.format(1), "1", "a whole pace has no decimal point")
t.expectEqual(ExportCommand.format(0.9), "0.9", "a fractional pace keeps its decimal")
t.expectEqual(ExportCommand.format(1.25), "1.25", "two decimals survive")

t.expectEqual(ExportOptions().speed, 1, "the natural pace is the default")

t.expectEqual(
  ExportPlan.commands(
    asin: "B1", options: ExportOptions(formats: [.audio], speed: 0.9),
    state: BookState(), workDir: "/w", userDataDir: "/s", destination: nil
  ).first(where: { $0.step == .audio })?.speed,
  0.9, "the plan carries the chosen pace to narration")

// MARK: - ExportPlan

func steps(
  _ options: ExportOptions, _ state: BookState = BookState(), destination: String? = nil
) -> [ExportStep] {
  ExportPlan.commands(
    asin: "B1", options: options, state: state,
    workDir: "/w", userDataDir: "/s", destination: destination
  ).map(\.step)
}

let extracted = BookState(capturedPages: 400, expectedPages: 400)
let transcribed = BookState(
  capturedPages: 400, expectedPages: 400, transcribedChunks: 400)
let finished = BookState(
  capturedPages: 400, expectedPages: 400, transcribedChunks: 400,
  cleanedChunks: 400)

t.expectEqual(
  steps(ExportOptions()),
  [.extractBook, .transcribe, .clean, .markdown],
  "a fresh book runs the whole pipeline")

t.expectEqual(
  steps(ExportOptions(), extracted),
  [.transcribe, .clean, .markdown],
  "skips extraction when every page is captured")

t.expectEqual(
  steps(ExportOptions(), transcribed),
  [.clean, .markdown],
  "skips transcription when every page is transcribed")

t.expectEqual(
  steps(ExportOptions(), finished), [.markdown],
  "re-exporting a finished book only rebuilds the artifact")

t.expectEqual(
  steps(ExportOptions(force: true), finished),
  [.extractBook, .transcribe, .clean, .markdown],
  "force redoes every step")

// An interrupted extraction must not pass for a finished one: transcribing
// it would produce a truncated book and report success.
t.expectEqual(
  steps(ExportOptions(), BookState(capturedPages: 50, expectedPages: 400)),
  [.extractBook, .transcribe, .clean, .markdown],
  "a part-captured book re-runs extraction")

t.expectEqual(
  steps(ExportOptions(), BookState(capturedPages: 50, expectedPages: nil)),
  [.extractBook, .transcribe, .clean, .markdown],
  "pages with no metadata to check against re-run extraction")

t.expectEqual(
  steps(
    ExportOptions(),
    BookState(capturedPages: 400, expectedPages: 400, transcribedChunks: 50)),
  [.transcribe, .clean, .markdown],
  "a part-transcribed book re-runs transcription")

t.expectEqual(
  steps(
    ExportOptions(),
    BookState(
      capturedPages: 400, expectedPages: 400, transcribedChunks: 400,
      cleanedChunks: 50)),
  [.clean, .markdown],
  "a part-cleaned book re-runs cleanup")

// A preview deliberately leaves a partial working set, so it can neither be
// satisfied by earlier work nor satisfy a later full export.
t.expectEqual(
  steps(ExportOptions(limit: 50), finished),
  [.extractBook, .transcribe, .clean, .markdown],
  "a preview always re-runs rather than reusing a full working set")

t.expectEqual(
  steps(ExportOptions(), BookState(capturedPages: 50, expectedPages: 400,
    transcribedChunks: 50, cleanedChunks: 50)),
  [.extractBook, .transcribe, .clean, .markdown],
  "a full export after a preview rebuilds the whole book")

t.expectEqual(
  steps(ExportOptions(clean: false), transcribed), [.markdown],
  "omits the cleanup pass when it is switched off")

t.expectEqual(
  steps(ExportOptions(formats: [.audio, .markdown, .pdf])),
  [.extractBook, .transcribe, .clean, .markdown, .pdf, .audio],
  "artifacts run in pipeline order, not set order")

t.expectEqual(
  steps(ExportOptions(formats: [])),
  [.extractBook, .transcribe, .clean],
  "no artifacts still prepares the content")

let limited = ExportPlan.commands(
  asin: "B1", options: ExportOptions(limit: 50), state: BookState(),
  workDir: "/w", userDataDir: "/s", destination: nil)
t.expect(
  limited.allSatisfy { $0.arguments.contains("--limit") },
  "a page limit reaches every step")

let destined = ExportPlan.commands(
  asin: "B1", options: ExportOptions(formats: [.markdown, .pdf]), state: BookState(),
  workDir: "/w", userDataDir: "/s", destination: "/Books")
t.expectEqual(
  destined.compactMap(\.outFile),
  ["/Books/B1.md", "/Books/B1.pdf"],
  "artifacts land in the chosen destination")
t.expect(
  destined.first(where: { $0.step == .extractBook })?.outFile == nil,
  "the working steps are not redirected to the destination")

t.expectEqual(
  ExportPlan.artifactPath(in: "/Books", step: .audio, asin: "B1"),
  "/Books/B1.m4b", "audio lands as an m4b audiobook")

// MARK: - Log tailing

// A short log that does not fill the panel is always at its end.
t.expect(
  ScrollMetrics(offset: 0, contentHeight: 40, viewportHeight: 180).isAtBottom(),
  "content shorter than the viewport counts as the bottom")

t.expect(
  ScrollMetrics(offset: 0, contentHeight: 180, viewportHeight: 180).isAtBottom(),
  "content exactly filling the viewport counts as the bottom")

t.expectEqual(
  ScrollMetrics(offset: 0, contentHeight: 40, viewportHeight: 180).maxOffset,
  0, "content that fits cannot be scrolled")

t.expect(
  ScrollMetrics(offset: 820, contentHeight: 1000, viewportHeight: 180).isAtBottom(),
  "resting exactly on the last line keeps following")

t.expect(
  ScrollMetrics(offset: 819, contentHeight: 1000, viewportHeight: 180).isAtBottom(),
  "a point short of the end still keeps following")

t.expect(
  ScrollMetrics(offset: 820 - ScrollMetrics.bottomSlop, contentHeight: 1000, viewportHeight: 180)
    .isAtBottom(),
  "the slop itself is still the bottom")

t.expect(
  !ScrollMetrics(offset: 819 - ScrollMetrics.bottomSlop, contentHeight: 1000, viewportHeight: 180)
    .isAtBottom(),
  "a point beyond the slop stops following")

// Scrolled back through a long run: new lines must not yank the reader down.
t.expect(
  !ScrollMetrics(offset: 0, contentHeight: 40_000, viewportHeight: 180).isAtBottom(),
  "the top of a large scrollback is not the bottom")

t.expect(
  !ScrollMetrics(offset: 12_000, contentHeight: 40_000, viewportHeight: 180).isAtBottom(),
  "the middle of a large scrollback is not the bottom")

t.expect(
  ScrollMetrics(offset: 39_820, contentHeight: 40_000, viewportHeight: 180).isAtBottom(),
  "the end of a large scrollback follows again")

// Appending a line moves the end away, so an already-following reader is
// carried with it while a paused one is not.
let grown = ScrollMetrics(offset: 820, contentHeight: 1014, viewportHeight: 180)
t.expect(grown.isAtBottom(), "one appended line stays within the slop")
t.expect(
  !ScrollMetrics(offset: 820, contentHeight: 1200, viewportHeight: 180).isAtBottom(),
  "many appended lines leave the reader behind the end")

t.expect(
  ScrollMetrics(offset: 0, contentHeight: 0, viewportHeight: 0).isAtBottom(),
  "an unmeasured panel starts out following")

t.expect(
  ScrollMetrics(offset: .nan, contentHeight: 1000, viewportHeight: 180).isAtBottom(),
  "an unmeasurable offset falls back to following")

t.expect(
  !ScrollMetrics(offset: 500, contentHeight: 1000, viewportHeight: 180).isAtBottom(slop: 0),
  "a caller can demand an exact bottom")

// MARK: - CLIRunner (integration)
//
// Opt-in: actually spawns the Node pipeline. Guarded because it needs a real
// repo checkout and an already-extracted book.
//   KINDLE_EXPORT_INTEGRATION=/path/to/repo swift run KindleExportCoreTests

if let repo = ProcessInfo.processInfo.environment["KINDLE_EXPORT_INTEGRATION"] {
  let runner = CLIRunner(config: ToolchainConfig(repoRoot: URL(fileURLWithPath: repo)))
  let asin = ProcessInfo.processInfo.environment["KINDLE_EXPORT_ASIN"] ?? "B003R50A4Q"
  let outFile = NSTemporaryDirectory() + "cli-runner-check.md"

  let collected = Collector()
  do {
    try await runner.run(
      ExportCommand(
        step: .markdown, asin: asin,
        workDir: ProcessInfo.processInfo.environment["KINDLE_EXPORT_WORKDIR"]
          ?? (repo + "/out"),
        userDataDir: repo + "/out/\(asin)/data",
        outFile: outFile)
    ) { collected.add($0) }

    let events = collected.events
    t.expect(events.contains(.stepStart(.markdown)), "runner sees step-start")
    t.expect(events.contains(.stepDone(.markdown)), "runner sees step-done")
    t.expect(events.contains(.done(outFile: outFile)), "runner sees done with the out file")
    t.expect(
      FileManager.default.fileExists(atPath: outFile),
      "runner produced the markdown file")
  } catch {
    t.expect(false, "runner completed without throwing: \(error)")
  }
} else {
  print("(skipping CLIRunner integration; set KINDLE_EXPORT_INTEGRATION)")
}

// MARK: - Job notifications

let finishedNotice = JobNotification.forOutcome(
  book: "Uprooted",
  outcome: .finished(artifacts: ["/Books/B1.md", "/Books/B1.m4b"]),
  destination: "/Users/reader/Books")

t.expectEqual(finishedNotice.title, "Export finished", "a completed export says so")
t.expect(finishedNotice.body.contains("Uprooted"), "the book is named")
t.expect(finishedNotice.body.contains("B1.md"), "the artifacts are listed")
t.expect(finishedNotice.body.contains("Books"), "the destination folder is named")
t.expect(!finishedNotice.isFailure, "a completed export is not a failure")

// Listing every file would overflow a notification banner.
let manyArtifacts = JobNotification.forOutcome(
  book: "Uprooted",
  outcome: .finished(artifacts: ["/b/a.md", "/b/a.pdf", "/b/a.m4b", "/b/a.txt"]),
  destination: "/b")
t.expect(manyArtifacts.body.contains("2 more"), "a long artifact list is summarised")

t.expect(
  JobNotification.forOutcome(
    book: "Uprooted", outcome: .finished(artifacts: []), destination: "/b"
  ).body.contains("Uprooted"),
  "a run with no artifacts still names the book")

// Failures arrive as multi-line stderr; a banner shows a line or two.
let failedNotice = JobNotification.forOutcome(
  book: "Hamlet",
  outcome: .failed("ffmpeg exited with 1\nat /some/path\nand more detail"))
t.expectEqual(failedNotice.title, "Export failed", "a failed export says so")
t.expect(failedNotice.isFailure, "a failed export is flagged as one")
t.expect(failedNotice.body.contains("ffmpeg exited with 1"), "the first line survives")
t.expect(!failedNotice.body.contains("and more detail"), "the trailing detail is dropped")
t.expect(
  failedNotice.body.split(separator: "\n").count == 1,
  "the body stays a single line")

t.expect(
  JobNotification.forOutcome(book: "Hamlet", outcome: .failed("   "))
    .body.contains("unknown error"),
  "an empty failure reason still says something")

t.expectEqual(
  JobNotification.forOutcome(book: "Hamlet", outcome: .cancelled).title,
  "Export cancelled", "a cancelled export says so")

t.finish(suite: "KindleExportCore")
