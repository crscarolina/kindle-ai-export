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

// MARK: - ExportPlan

func steps(
  _ options: ExportOptions, _ state: BookState = BookState(), destination: String? = nil
) -> [ExportStep] {
  ExportPlan.commands(
    asin: "B1", options: options, state: state,
    workDir: "/w", userDataDir: "/s", destination: destination
  ).map(\.step)
}

t.expectEqual(
  steps(ExportOptions()),
  [.extractBook, .transcribe, .clean, .markdown],
  "a fresh book runs the whole pipeline")

t.expectEqual(
  steps(ExportOptions(), BookState(hasPages: true)),
  [.transcribe, .clean, .markdown],
  "skips extraction when pages already exist")

t.expectEqual(
  steps(ExportOptions(), BookState(hasPages: true, hasContent: true)),
  [.clean, .markdown],
  "skips transcription when content already exists")

t.expectEqual(
  steps(
    ExportOptions(),
    BookState(hasPages: true, hasContent: true, hasCleanedContent: true)),
  [.markdown],
  "re-exporting a finished book only rebuilds the artifact")

t.expectEqual(
  steps(
    ExportOptions(force: true),
    BookState(hasPages: true, hasContent: true, hasCleanedContent: true)),
  [.extractBook, .transcribe, .clean, .markdown],
  "force redoes every step")

t.expectEqual(
  steps(ExportOptions(clean: false), BookState(hasPages: true, hasContent: true)),
  [.markdown],
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
  "/Books/B1.wav", "audio lands as a wav")

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
        workDir: repo + "/out", userDataDir: repo + "/out/\(asin)/data",
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

t.finish(suite: "KindleExportCore")
