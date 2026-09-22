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

// MARK: - Artifact file names

func named(
  _ title: String, _ authors: [String] = [], year: Int? = nil,
  asin: String = "B003R50A4Q", ext: String = ".md"
) -> String {
  BookNaming(title: title, authors: authors, year: year)
    .fileName(asin: asin, fileExtension: ext)
}

t.expectEqual(
  named("Daughter of the Forest: A Sevenwaters Novel 1", ["Juliet Marillier"]),
  "Marillier,_Juliet_-_Daughter_of_the_Forest_-_A_Sevenwaters_Novel_1_(B003R50A4Q).md",
  "the canonical example is surname-first, with no year to show")

t.expectEqual(
  named("Daughter of the Forest", ["Juliet Marillier"], year: 2000),
  "Marillier,_Juliet_-_Daughter_of_the_Forest_(2000)_(B003R50A4Q).md",
  "a known year sits between the title and the ASIN")

t.expect(
  !named("Daughter of the Forest", ["Juliet Marillier"]).contains("()"),
  "an unknown year leaves no empty brackets behind")

t.expectEqual(
  named("There Is No Antimemetics Division", ["qntm"], asin: "B0DGH7KZ7Y"),
  "qntm_-_There_Is_No_Antimemetics_Division_(B0DGH7KZ7Y).md",
  "a single-word author keeps their one name, with no comma")

t.expectEqual(
  named("Good Omens", ["Terry Pratchett", "Neil Gaiman"], asin: "B1"),
  "Pratchett,_Terry_-_Good_Omens_(B1).md",
  "only the first author is credited in the filename")

t.expectEqual(
  named("Title", ["Marillier, Juliet"], asin: "B1"),
  "Marillier,_Juliet_-_Title_(B1).md",
  "a name already in surname order is not reversed a second time")

t.expectEqual(
  named("Good Omens", [], asin: "B1"), "Good_Omens_(B1).md",
  "a book with no author is named by its title alone")

t.expectEqual(
  named("", [], asin: "B1"), "B1.md",
  "with nothing to describe the book, the ASIN alone names the file")

t.expectEqual(
  named("", [], year: 2000, asin: "B1"), "(2000)_(B1).md",
  "a year without a title still keeps its brackets")

t.expect(
  !named("A: B", ["X Y"], asin: "B1").contains(":"),
  "no colon survives, since Finder draws one as a slash")

t.expectEqual(
  named("Either/Or", [], asin: "B1"), "Either-Or_(B1).md",
  "a slash in a title cannot open a new path component")

let traversal = named("../../etc/passwd", [], asin: "B1")
t.expectEqual(
  traversal, "etc-passwd_(B1).md", "a traversing title is flattened to a plain name")
t.expect(!traversal.contains("/"), "a title cannot climb out of the destination folder")
t.expect(!traversal.hasPrefix("."), "an export is never a hidden file")

t.expectEqual(
  named("--force", [], asin: "B1"), "force_(B1).md",
  "a name never opens with a dash, which a shell would read as a flag")

t.expectEqual(
  named("Spaced   Out__Title", [], asin: "B1"), "Spaced_Out_Title_(B1).md",
  "runs of separators collapse to a single underscore")

t.expectEqual(
  named("The thrilling novel, 'mind-bendingly brilliant' Guardian", [], asin: "B1"),
  "The_thrilling_novel,_mind-bendingly_brilliant_Guardian_(B1).md",
  "quotes are dropped so the name survives a paste into a shell")

t.expectEqual(
  named("Tab\tand\u{0}null", [], asin: "B1"), "Tab_andnull_(B1).md",
  "control characters are removed rather than written into the name")

let long = named(
  String(repeating: "Antimemetics ", count: 40), ["qntm"], year: 2021,
  asin: "B0DGH7KZ7Y")
t.expect(long.utf8.count <= 255, "a very long title is capped at the filesystem's limit")
t.expect(
  long.hasSuffix("_(2021)_(B0DGH7KZ7Y).md"),
  "truncation keeps the year, the ASIN and the extension intact")
t.expect(long.hasPrefix("qntm_-_Antimemetics"), "truncation trims the tail of the title")
t.expect(!long.contains("__"), "truncation does not leave a doubled separator")

let accented = named(String(repeating: "é", count: 400), [], asin: "B1")
t.expect(accented.utf8.count <= 255, "the cap counts bytes, as the filesystem does")
t.expect(accented.hasSuffix("_(B1).md"), "a multi-byte title still ends in its ASIN")

let marillier = BookNaming(
  title: "Daughter of the Forest: A Sevenwaters Novel 1", authors: ["Juliet Marillier"])
t.expectEqual(
  ExportPlan.artifactPath(
    in: "/Books", step: .markdown, asin: "B003R50A4Q", naming: marillier),
  "/Books/Marillier,_Juliet_-_Daughter_of_the_Forest_-_A_Sevenwaters_Novel_1_(B003R50A4Q).md",
  "the plan names artifacts for people, inside the chosen destination")

t.expectEqual(
  ExportPlan.commands(
    asin: "B003R50A4Q", options: ExportOptions(formats: [.markdown, .pdf]),
    state: BookState(), workDir: "/w", userDataDir: "/s", destination: "/Books",
    naming: marillier
  ).compactMap(\.outFile),
  [
    "/Books/Marillier,_Juliet_-_Daughter_of_the_Forest_-_A_Sevenwaters_Novel_1_(B003R50A4Q).md",
    "/Books/Marillier,_Juliet_-_Daughter_of_the_Forest_-_A_Sevenwaters_Novel_1_(B003R50A4Q).pdf",
  ],
  "every artifact of one book shares a name but for the extension")

t.expect(
  ExportPlan.artifactPath(
    in: "/Books", step: .markdown, asin: "B1",
    naming: BookNaming(title: "../../etc/passwd")
  ).hasPrefix("/Books/"),
  "a hostile title cannot write outside the destination")

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

// MARK: - Step names

// The raw values are command-line identifiers; the interface should not show
// the reader lowercase jargon like "extract" and "pdf".
for step in ExportStep.allCases {
  let name = step.displayName
  t.expect(
    name.first.map { $0.isUppercase } == true,
    "\(step.rawValue) is capitalised: \(name)")
  t.expect(name != step.rawValue, "\(step.rawValue) is not shown verbatim")
  t.expect(!step.detail.isEmpty, "\(step.rawValue) explains itself")
  t.expect(!step.symbolName.isEmpty, "\(step.rawValue) has a symbol")
}

t.expectEqual(ExportStep.extractBook.displayName, "Capture Pages", "extract reads as capture")
t.expectEqual(ExportStep.audio.displayName, "Audiobook", "audio reads as audiobook")

t.expectEqual(
  Set(ExportStep.allCases.map(\.displayName)).count, ExportStep.allCases.count,
  "no two steps share a name")

// MARK: - Job timeline

var timeline = JobTimeline(steps: [.extractBook, .transcribe, .markdown])

t.expectEqual(timeline.steps.count, 3, "the timeline holds every planned step")
t.expect(timeline.steps.allSatisfy { $0.state == .pending }, "all steps start pending")
t.expectEqual(timeline.overallFraction, 0, "nothing done means zero progress")
t.expect(timeline.currentStep == nil, "nothing is running yet")

timeline.start(.extractBook)
t.expect(timeline.currentStep == .extractBook, "the started step is current")
t.expect(timeline.steps[0].fraction == nil, "a step with no total yet draws no bar")

timeline.advance(.extractBook, completed: 326, total: 652)
t.expectEqual(timeline.steps[0].fraction, 0.5, "progress is reported as a fraction")
t.expectEqual(timeline.steps[0].detailText, "326 of 652", "progress reads naturally")
t.expectEqual(timeline.overallFraction, 0.5 / 3, "a part-done step is a part share")

// Steps run in order, so a later one starting proves the earlier ones
// finished -- even if their step-done event was missed.
timeline.start(.markdown)
t.expectEqual(timeline.steps[0].state, .done, "an earlier step is completed implicitly")
t.expectEqual(timeline.steps[1].state, .done, "every earlier step is completed")

timeline.finish(.markdown)
t.expectEqual(timeline.overallFraction, 1, "all steps done is full progress")
t.expect(timeline.currentStep == nil, "nothing runs once everything is done")

// A failure stops the pipeline; later steps never ran.
var failing = JobTimeline(steps: [.extractBook, .transcribe, .markdown])
failing.start(.extractBook)
failing.fail(.extractBook, "Chrome would not start")
t.expectEqual(failing.steps[0].state, .failed("Chrome would not start"), "the step records why")
t.expectEqual(failing.steps[1].state, .skipped, "the next step is skipped, not waiting")
t.expectEqual(failing.steps[2].state, .skipped, "every later step is skipped")
t.expect(failing.steps[0].fraction == nil, "a failed step draws no bar")
t.expectEqual(failing.steps[1].detailText, "Skipped", "a skipped step says so")

// Progress can outrun the total when a page spans several screenshots.
var overrun = JobTimeline(steps: [.extractBook])
overrun.start(.extractBook)
overrun.advance(.extractBook, completed: 741, total: 652)
t.expectEqual(overrun.steps[0].fraction, 1, "progress never exceeds full")

var zero = JobTimeline(steps: [])
t.expectEqual(zero.overallFraction, 0, "an empty timeline is not a divide by zero")

var fromCommands = JobTimeline(commands: ExportPlan.commands(
  asin: "B1", options: ExportOptions(formats: [.markdown, .pdf]),
  state: BookState(), workDir: "/w", userDataDir: "/s", destination: nil))
t.expectEqual(
  fromCommands.steps.map(\.step),
  [.extractBook, .transcribe, .clean, .markdown, .pdf],
  "a timeline can be built straight from the plan")

fromCommands.finishAll()
t.expectEqual(fromCommands.overallFraction, 1, "finishing all marks everything done")

// MARK: - Copying the log

t.expectEqual(LogClipboard.text(for: []), "", "an empty log copies nothing")
t.expectEqual(
  LogClipboard.text(for: ["wrote /tmp/book.md"]),
  "wrote /tmp/book.md\n",
  "a single line ends with a newline")
t.expectEqual(
  LogClipboard.text(for: ["step-start extract", "page 3/40", "done"]),
  "step-start extract\npage 3/40\ndone\n",
  "lines are joined in order, one per line")
t.expectEqual(
  LogClipboard.text(for: ["first", "", "third"]),
  "first\n\nthird\n",
  "a blank log line stays blank rather than collapsing")

// MARK: - Paging the library grid
//
// The grid renders a page at a time. The bug these cover: paging advanced
// exactly once and then stalled, leaving a footer claiming 114 more books
// that never arrived.

var page = PageWindow()
t.expectEqual(page.pageSize, 60, "a page is 60 books by default")
t.expectEqual(page.visibleCount(total: 234), 60, "a large library starts at one page")
t.expect(page.hasMore(total: 234), "234 books do not fit in one page")
t.expectEqual(page.remaining(total: 234), 174, "174 books are held back at first")

page.advance(total: 234)
t.expectEqual(page.visibleCount(total: 234), 120, "one step adds a page")
t.expectEqual(page.remaining(total: 234), 114, "the reported remainder matches the report")

// The stall: from here the window must keep widening to the end.
var steps = 0
while page.hasMore(total: 234), steps < 100 {
  let before = page.visibleCount(total: 234)
  page.advance(total: 234)
  t.expect(page.visibleCount(total: 234) > before, "every step makes progress")
  steps += 1
}
t.expectEqual(steps, 2, "234 books need two more steps after the first")
t.expectEqual(page.visibleCount(total: 234), 234, "paging ends with the whole library shown")
t.expectEqual(page.remaining(total: 234), 0, "nothing is held back at the end")
t.expect(!page.hasMore(total: 234), "a fully shown library has no more to show")

page.advance(total: 234)
t.expectEqual(page.visibleCount(total: 234), 234, "advancing past the end is a no-op")

// MARK: Boundaries

var exact = PageWindow()
t.expectEqual(exact.visibleCount(total: 60), 60, "a library of exactly one page is all shown")
t.expect(!exact.hasMore(total: 60), "60 books show no footer")
t.expectEqual(exact.remaining(total: 60), 0, "60 books leave nothing over")
exact.advance(total: 120)
t.expectEqual(exact.visibleCount(total: 120), 120, "120 books take exactly two pages")
t.expect(!exact.hasMore(total: 120), "an exact multiple never shows a 0 more footer")
t.expectEqual(exact.remaining(total: 120), 0, "an exact multiple leaves nothing over")

var narrow = PageWindow()
t.expectEqual(narrow.visibleCount(total: 3), 3, "a search narrowed to 3 shows 3")
t.expect(!narrow.hasMore(total: 3), "a set smaller than a page has no more to show")
t.expect(
  !narrow.shouldAdvance(appearedIndex: 2, total: 3),
  "the last of 3 results does not trigger paging")

var empty = PageWindow()
t.expectEqual(empty.visibleCount(total: 0), 0, "an empty library shows nothing")
t.expect(!empty.hasMore(total: 0), "an empty library has no more to show")
t.expectEqual(empty.remaining(total: 0), 0, "an empty library holds nothing back")
t.expect(
  !empty.shouldAdvance(appearedIndex: 0, total: 0),
  "an empty library cannot trigger paging")

// MARK: When a cell triggers the next page

var trigger = PageWindow()
t.expect(
  !trigger.shouldAdvance(appearedIndex: 0, total: 234),
  "the first cell does not drag in the next page")
t.expect(
  !trigger.shouldAdvance(appearedIndex: 40, total: 234),
  "a cell in the middle of the page does not trigger")
t.expect(
  trigger.shouldAdvance(appearedIndex: 59, total: 234),
  "the last rendered cell triggers the next page")
t.expect(
  trigger.shouldAdvance(appearedIndex: 55, total: 234),
  "the last row triggers slightly before the very end")

trigger.advance(total: 234)
t.expect(
  !trigger.shouldAdvance(appearedIndex: 59, total: 234),
  "a cell that was the trigger stops triggering once its page is in")
t.expect(
  trigger.shouldAdvance(appearedIndex: 119, total: 234),
  "the new last cell takes over as the trigger")

// MARK: Resetting, as a search or a refresh does

var searched = PageWindow()
searched.advance(total: 234)
searched.advance(total: 234)
t.expectEqual(searched.visibleCount(total: 234), 180, "three pages are shown before the search")
searched.reset()
t.expectEqual(searched.visibleCount(total: 234), 60, "a reset goes back to one page")
t.expect(searched.hasMore(total: 234), "a reset library can be paged again")
t.expect(
  searched.shouldAdvance(appearedIndex: 59, total: 234),
  "paging still triggers after a reset")

// A reset while a narrow search is showing, then the search cleared: the
// window must not be left stuck at the narrowed size.
searched.reset()
t.expectEqual(searched.visibleCount(total: 2), 2, "a narrowed search shows its 2 results")
t.expectEqual(searched.visibleCount(total: 234), 60, "clearing the search shows a full page again")

var refreshed = PageWindow()
refreshed.advance(total: 234)
refreshed.reset()
t.expectEqual(refreshed.visibleCount(total: 200), 60, "a refresh to a shorter library starts over")
t.expect(refreshed.hasMore(total: 200), "the shorter library still pages")

// MARK: Odd configurations

var small = PageWindow(pageSize: 4, lookahead: 1)
t.expectEqual(small.visibleCount(total: 10), 4, "a custom page size is honoured")
t.expect(
  !small.shouldAdvance(appearedIndex: 2, total: 10),
  "a one-cell lookahead does not trigger a cell early")
t.expect(
  small.shouldAdvance(appearedIndex: 3, total: 10),
  "a one-cell lookahead triggers on the last cell")
small.advance(total: 10)
small.advance(total: 10)
t.expectEqual(small.visibleCount(total: 10), 10, "a page size that does not divide evenly still ends exactly")

var degenerate = PageWindow(pageSize: 0, lookahead: 0)
t.expectEqual(degenerate.pageSize, 1, "a page size below one is clamped")
t.expectEqual(degenerate.visibleCount(total: 5), 1, "a clamped page still shows something")
degenerate.advance(total: 5)
t.expectEqual(degenerate.visibleCount(total: 5), 2, "a clamped page still advances")

// MARK: - Setup requirements

for requirement in Requirement.allCases {
  t.expect(!requirement.title.isEmpty, "\(requirement.rawValue) has a title")
  t.expect(!requirement.detail.isEmpty, "\(requirement.rawValue) explains itself")
  t.expect(!requirement.remedy.isEmpty, "\(requirement.rawValue) says what to do")
}

let nothing = RequirementsReport()
t.expect(!nothing.isComplete, "a fresh install is not ready")
t.expectEqual(nothing.missing.count, Requirement.allCases.count, "everything is missing")
t.expectEqual(nothing.currentStep, .requirements, "setup starts at requirements")

// The later steps depend on the earlier: there is no point signing in to
// Amazon when the browser that would carry the session is not installed.
var partly = RequirementsReport(satisfied: [.amazonSession])
t.expectEqual(
  partly.currentStep, .requirements,
  "an existing session does not skip missing tools")

partly.satisfied.formUnion([.chrome, .claudeInstalled, .claudeSignedIn, .pipeline])
t.expectEqual(partly.currentStep, .testRun, "with everything met, only the test run is left")
t.expect(partly.isComplete, "everything satisfied is complete")

let toolsOnly = RequirementsReport(satisfied: [
  .chrome, .claudeInstalled, .claudeSignedIn, .pipeline,
])
t.expectEqual(toolsOnly.currentStep, .account, "tools met moves on to the account")
t.expect(toolsOnly.isComplete(.requirements), "the requirements step is done")
t.expect(!toolsOnly.isComplete(.account), "the account step is not")

// A failure surfaces far from its cause -- an expired Amazon session shows up
// as a timeout inside extraction -- so each requirement names the step that
// can actually fix it.
t.expectEqual(
  toolsOnly.step(toFix: .amazonSession), .account,
  "a lapsed session sends the reader to the account step")
t.expectEqual(
  toolsOnly.step(toFix: .claudeSignedIn), .requirements,
  "a lapsed Claude sign-in sends the reader to requirements")

t.expectEqual(
  Requirement.chrome.helpURL?.host(), "www.google.com",
  "Chrome links somewhere useful")
t.expect(
  Requirement.amazonSession.helpURL == nil,
  "a requirement the app itself fixes needs no link")

t.expectEqual(SetupStep.allCases.count, 3, "three steps, as designed")
t.expect(SetupStep.requirements < SetupStep.account, "steps are ordered")

t.finish(suite: "KindleExportCore")
