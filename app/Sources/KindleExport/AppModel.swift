import Foundation
import KindleExportCore
import Observation

/// SwiftUI declares its own `LibraryItem`, so refer to ours by an alias.
typealias Book = KindleExportCore.LibraryItem

/// Persisted preferences.
///
/// No Amazon credentials: the browser profile carries the session, so there
/// is nothing for the app to store and nothing to leak.
@Observable
@MainActor
final class AppSettings {
  /// An explicit checkout chosen in Settings. Empty means use the bundled
  /// pipeline, which is the normal case.
  var repoPathOverride: String {
    didSet { defaults.set(repoPathOverride, forKey: "repoPath") }
  }
  var destination: String {
    didSet { defaults.set(destination, forKey: "destination") }
  }

  /// Run without Claude Code, giving up the OCR cleanup pass.
  ///
  /// A deliberate choice rather than a fallback: the reader says in setup
  /// that they do not want to install it, and every export afterwards skips
  /// cleanup without asking again.
  var skipClaude: Bool {
    didSet { defaults.set(skipClaude, forKey: "skipClaude") }
  }

  private let defaults = UserDefaults.standard

  init() {
    let defaults = UserDefaults.standard
    repoPathOverride = defaults.string(forKey: "repoPath") ?? ""
    skipClaude = defaults.bool(forKey: "skipClaude")
    destination =
      defaults.string(forKey: "destination")
      ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        .first?.path(percentEncoded: false) ?? ""
  }

  /// The Node pipeline shipped inside the app.
  ///
  /// A release build copies the checkout here; a debug build symlinks it to
  /// the working tree, so development edits take effect without rebuilding
  /// the bundle.
  static let bundledRepoPath: String? = {
    guard let resources = Bundle.main.resourceURL else { return nil }
    let repo = resources.appending(path: "repo")
    let tsx = repo.appending(path: "node_modules/tsx/dist/cli.mjs")
    return FileManager.default.fileExists(atPath: tsx.path(percentEncoded: false))
      ? repo.path(percentEncoded: false)
      : nil
  }()

  /// Where the pipeline actually lives: an explicit override if one is set,
  /// otherwise the copy inside the bundle.
  var repoPath: String {
    repoPathOverride.isEmpty ? (Self.bundledRepoPath ?? "") : repoPathOverride
  }

  var usingBundledRepo: Bool {
    repoPathOverride.isEmpty && Self.bundledRepoPath != nil
  }

  var home: String { NSHomeDirectory() }
  var workDir: String { appSupport }
  var sessionDir: String { appSupport + "/session" }
  private var appSupport: String {
    home + "/Library/Application Support/kindle-ai-export"
  }

  var toolchain: ToolchainConfig {
    ToolchainConfig(repoRoot: URL(fileURLWithPath: repoPath))
  }

  var hasNode: Bool { ToolchainConfig.locateNode() != nil }

  var isConfigured: Bool {
    !repoPath.isEmpty && hasNode
      && FileManager.default.fileExists(
        atPath: repoPath + "/node_modules/tsx/dist/cli.mjs")
  }
}

/// One queued export.
@Observable
@MainActor
final class ExportJob: Identifiable {
  enum State: Equatable {
    case queued
    case running(step: ExportStep, completed: Int, total: Int)
    case finished
    case failed(String)
    case cancelled
  }

  let id = UUID()
  let item: Book
  let options: ExportOptions
  let destination: String
  var state: State = .queued
  /// Every step this job will run, and how far each has got.
  ///
  /// Populated once the plan is known, which is when the job starts -- what
  /// runs depends on what is already on disk.
  var timeline = JobTimeline(steps: [])

  init(item: Book, options: ExportOptions, destination: String) {
    self.item = item
    self.options = options
    self.destination = destination
  }

  var statusText: String {
    switch state {
    case .queued: "Queued"
    case .running(let step, let completed, let total):
      total > 0
        ? "\(step.displayName) \(completed)/\(total)" : "\(step.displayName)…"
    case .finished: "Done"
    case .failed(let message): "Failed — \(message)"
    case .cancelled: "Cancelled"
    }
  }

  var progress: Double? {
    guard case .running(_, let completed, let total) = state, total > 0 else {
      return nil
    }
    return Double(completed) / Double(total)
  }
}

@Observable
@MainActor
final class AppModel {
  var settings = AppSettings()
  var library: [Book] = []
  var search = "" {
    didSet { if search != oldValue { resetPaging() } }
  }
  var selectedAsin: String?
  var jobs: [ExportJob] = []
  var log: [String] = []
  var showLog = false
  var voices: [VoiceOption] = []

  // MARK: - Setup

  var requirements = RequirementsReport()
  var isCheckingRequirements = false
  /// Shown until setup completes, or whenever the reader reopens it.
  var showSetup = false
  var setupStep: SetupStep = .requirements
  var testRunOutcome: String?
  var isTestRunning = false

  private let checker = RequirementsChecker()
  /// A transient note shown over the library.
  ///
  /// Cleared on a timer: it used to persist for the life of the window, so
  /// "234 books" from a refresh sat there contradicting a search that had
  /// narrowed the grid to three.
  var status: String? {
    didSet {
      guard status != nil else { return }
      statusDismissal?.cancel()
      statusDismissal = Task { [weak self] in
        try? await Task.sleep(for: .seconds(4))
        guard !Task.isCancelled else { return }
        self?.status = nil
      }
    }
  }

  private var statusDismissal: Task<Void, Never>?
  var isBusy = false
  /// Set when Amazon's session lapses; pauses the queue rather than failing it.
  var needsSignIn = false

  var options = ExportOptions()

  private var isPumping = false
  private let notifier = Notifier()

  /// Artifacts the running job has written, for the completion notification.
  private var producedArtifacts: [String] = []

  var filteredLibrary: [Book] {
    guard !search.isEmpty else { return library }
    return library.filter {
      $0.title.localizedCaseInsensitiveContains(search)
        || $0.authorLine.localizedCaseInsensitiveContains(search)
    }
  }

  /// How many covers to render. See `PageWindow` for why the grid is paged.
  static let pageSize = PageWindow.defaultPageSize
  private var page = PageWindow()

  var visibleCount: Int {
    page.visibleCount(total: filteredLibrary.count)
  }

  var visibleLibrary: [Book] {
    Array(filteredLibrary.prefix(visibleCount))
  }

  var hasMoreToShow: Bool {
    page.hasMore(total: filteredLibrary.count)
  }

  /// How many books are still held back.
  var remainingToShow: Int {
    page.remaining(total: filteredLibrary.count)
  }

  /// Called as each cell appears, so the grid grows only once the reader has
  /// scrolled near the end of what is already rendered.
  func cellAppeared(at index: Int) {
    guard page.shouldAdvance(appearedIndex: index, total: filteredLibrary.count)
    else { return }
    showMore()
  }

  func showMore() {
    page.advance(total: filteredLibrary.count)
  }

  /// Start again from the top whenever the visible set changes underneath.
  func resetPaging() {
    page.reset()
  }

  var selectedItem: Book? {
    library.first { $0.asin == selectedAsin }
  }

  private var runner: CLIRunner { CLIRunner(config: settings.toolchain) }

  private var libraryCachePath: String {
    settings.workDir + "/library.json"
  }

  private var voicesCachePath: String {
    settings.workDir + "/voices.json"
  }

  var previewsDir: String { settings.workDir + "/previews" }

  /// The clip auditioning the current voice and pace, if one exists.
  ///
  /// Falls back to the natural-pace clip so the button still works before a
  /// preview has been rendered at the chosen speed.
  var selectedVoicePreview: URL? {
    let dir = URL(fileURLWithPath: previewsDir)
    let candidates =
      options.speed == 1
      ? ["\(options.voice).m4b"]
      : ["\(options.voice)@\(ExportCommand.format(options.speed))x.m4b",
         "\(options.voice).m4b"]

    for name in candidates {
      let url = dir.appending(path: name)
      if FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) {
        return url
      }
    }
    return nil
  }

  /// Whether the clip on offer was rendered at the chosen pace.
  var previewMatchesPace: Bool {
    guard let preview = selectedVoicePreview else { return true }
    let expected =
      options.speed == 1
      ? "\(options.voice).m4b"
      : "\(options.voice)@\(ExportCommand.format(options.speed))x.m4b"
    return preview.lastPathComponent == expected
  }

  var selectedVoice: VoiceOption? {
    voices.first { $0.id == options.voice }
  }

  // MARK: - Voices

  func loadVoices() async {
    if let data = FileManager.default.contents(atPath: voicesCachePath),
      let cached = try? JSONDecoder().decode([VoiceOption].self, from: data)
    {
      voices = cached
      return
    }

    guard settings.isConfigured else { return }

    // Cheap: no browser, no model -- it only prints the catalogue.
    try? await runner.runScript(
      "src/list-voices.ts",
      arguments: ["--out-file", voicesCachePath, "--json"]
    ) { _ in }

    if let data = FileManager.default.contents(atPath: voicesCachePath),
      let loaded = try? JSONDecoder().decode([VoiceOption].self, from: data)
    {
      voices = loaded
    }
  }

  func requestNotificationAuthorization() async {
    await notifier.requestAuthorization()
  }

  /// Re-check everything setup depends on.
  ///
  /// Run whenever the window appears and whenever the reader says they have
  /// fixed something, since all of it -- an installed app, a signed-in CLI, a
  /// browser session -- can change outside this process.
  func checkRequirements() async {
    isCheckingRequirements = true
    defer { isCheckingRequirements = false }

    var satisfied: Set<Requirement> = []

    if checker.hasChrome() { satisfied.insert(.chrome) }
    if settings.isConfigured { satisfied.insert(.pipeline) }

    // Don't spawn `claude auth status` on every re-check for a reader who has
    // said they are not using it.
    var waived: Set<Requirement> = []
    if settings.skipClaude {
      waived = [.claudeInstalled, .claudeSignedIn]
    } else {
      if checker.claudeExecutable() != nil { satisfied.insert(.claudeInstalled) }
      if await checker.isClaudeSignedIn() { satisfied.insert(.claudeSignedIn) }
    }

    // A profile directory with cookies in it is the only evidence available
    // without opening a browser; whether the session is still valid shows up
    // when it is used.
    let cookies = settings.sessionDir + "/Default/Cookies"
    if FileManager.default.fileExists(atPath: cookies) {
      satisfied.insert(.amazonSession)
    }

    requirements = RequirementsReport(satisfied: satisfied, waived: waived)
    // Deliberately does not move `setupStep`. This runs on a timer-ish
    // cadence -- every re-check, every field edit -- and moving the step
    // here yanked the form away mid-keystroke. The two places that present
    // the wizard choose the opening step; after that it is the reader's.
  }

  /// Send the reader to the step that can fix a given requirement.
  func returnToSetup(toFix requirement: Requirement) {
    setupStep = requirements.step(toFix: requirement)
    testRunOutcome = nil
    showSetup = true
  }

  /// Prove the whole chain works, on the smallest book available.
  ///
  /// Listing the library exercises the browser, the profile and the Amazon
  /// session together -- the three things most likely to be wrong, and the
  /// ones a reader cannot easily check for themselves.
  func runSetupTest() async {
    isTestRunning = true
    testRunOutcome = nil
    defer { isTestRunning = false }

    await refreshLibrary()

    if needsSignIn {
      testRunOutcome = nil
      returnToSetup(toFix: .amazonSession)
      return
    }

    testRunOutcome =
      library.isEmpty
      ? "Signed in, but no books came back. If your library really is empty, there is nothing to export yet."
      : "Found \(library.count) book\(library.count == 1 ? "" : "s"). Everything is working."
  }

  func clearLog() {
    log.removeAll()
  }

  // MARK: - Library

  func loadCachedLibrary() {
    guard let data = FileManager.default.contents(atPath: libraryCachePath),
      let items = try? JSONDecoder().decode([Book].self, from: data)
    else { return }
    library = items
  }

  func refreshLibrary() async {
    guard settings.isConfigured else {
      status = "Set the repository path in Settings first."
      return
    }

    isBusy = true
    status = "Loading library…"
    defer { isBusy = false }

    let out = libraryCachePath
    try? FileManager.default.createDirectory(
      atPath: settings.workDir, withIntermediateDirectories: true)

    do {
      try await consumingEvents(job: nil) { emit in
        try await runner.runScript(
          "src/list-library.ts",
          arguments: [
            "--user-data-dir", settings.sessionDir, "--out-file", out, "--json",
          ],
          onEvent: emit)
      }

      loadCachedLibrary()
      resetPaging()
      status = "\(library.count) books"
    } catch CLIRunnerError.sessionExpired {
      needsSignIn = true
      status = "Sign in to Amazon from Settings."
    } catch {
      status = error.localizedDescription
    }
  }

  func signIn() async {
    guard settings.isConfigured else {
      status = "Set the repository path in Settings first."
      return
    }

    isBusy = true
    status = "Complete sign-in in the Chrome window…"
    defer { isBusy = false }

    do {
      try await consumingEvents(job: nil) { emit in
        try await runner.runScript(
          "src/sign-in.ts",
          arguments: ["--user-data-dir", settings.sessionDir, "--json"],
          onEvent: emit)
      }
      needsSignIn = false
      status = "Signed in."
      // The queue paused rather than failed, so pick it up again.
      startPumpIfNeeded()
    } catch {
      status = "Sign-in failed: \(error.localizedDescription)"
    }
  }

  // MARK: - Queue

  func enqueueSelected() {
    guard let item = selectedItem else { return }
    jobs.append(
      ExportJob(
        item: item, options: effectiveOptions,
        destination: settings.destination))
    startPumpIfNeeded()
  }

  /// What to actually run, as opposed to what the panel last showed.
  ///
  /// Skipping Claude removes the cleanup pass outright, and the toggle is
  /// disabled to say so. Forcing it here too means a value left over from
  /// before the reader opted out cannot quietly schedule a step that would
  /// fail on a machine with no `claude` on it.
  var effectiveOptions: ExportOptions {
    var resolved = options
    if settings.skipClaude { resolved.clean = false }
    return resolved
  }

  func clearFinishedJobs() {
    jobs.removeAll { $0.isFinished }
  }

  func remove(_ job: ExportJob) {
    if case .running = job.state { return }
    jobs.removeAll { $0.id == job.id }
  }

  /// Runs jobs strictly one at a time.
  ///
  /// Chromium takes an exclusive lock on the shared profile directory, so a
  /// second concurrent extraction would simply fail to launch.
  private func startPumpIfNeeded() {
    guard !isPumping, !needsSignIn else { return }
    isPumping = true

    Task { [weak self] in
      guard let self else { return }

      while let job = self.nextQueuedJob(), !self.needsSignIn {
        await self.run(job)
      }

      self.isPumping = false

      // Both statements run without suspending, so a job enqueued while the
      // previous one was finishing cannot slip between them and be stranded
      // in the queue with no pump to pick it up.
      if self.nextQueuedJob() != nil, !self.needsSignIn {
        self.startPumpIfNeeded()
      }
    }
  }

  private func nextQueuedJob() -> ExportJob? {
    jobs.first { $0.state == .queued }
  }

  private func run(_ job: ExportJob) async {
    clearLog()
    producedArtifacts = []
    let state = inspect(asin: job.item.asin)
    let commands = ExportPlan.commands(
      asin: job.item.asin,
      options: job.options,
      state: state,
      workDir: settings.workDir,
      userDataDir: settings.sessionDir,
      destination: job.destination,
      naming: BookNaming(title: job.item.title, authors: job.item.authors))

    job.timeline = JobTimeline(commands: commands)

    for command in commands {
      job.state = .running(step: command.step, completed: 0, total: 0)
      job.timeline.start(command.step)
      do {
        try await consumingEvents(job: job) { emit in
          try await runner.run(
            command, onEvent: emit)
        }
      } catch CLIRunnerError.sessionExpired {
        needsSignIn = true
        // Back to queued, not failed: the book is retried once the reader
        // signs in, rather than being quietly dropped from the queue.
        job.state = .queued
        status = "Queue paused — sign in again from Settings."
        return
      } catch {
        job.state = .failed(error.localizedDescription)
        job.timeline.fail(command.step, error.localizedDescription)
        await notify(job, .failed(error.localizedDescription))
        return
      }

      job.timeline.finish(command.step)
    }

    job.state = .finished
    job.timeline.finishAll()
    // Only the artifacts the reader asked for, not the working files.
    await notify(
      job,
      .finished(
        artifacts: producedArtifacts.filter { $0.hasPrefix(job.destination) }))
  }

  private func notify(_ job: ExportJob, _ outcome: JobOutcome) async {
    await notifier.post(
      JobNotification.forOutcome(
        book: job.item.title, outcome: outcome, destination: job.destination))
  }

  /// What already exists on disk for this book.
  ///
  /// Counts rather than checks for existence: a half-finished extraction
  /// leaves a populated `pages/` directory, and treating that as done would
  /// transcribe a truncated book and report success.
  private func inspect(asin: String) -> BookState {
    let book = settings.workDir + "/" + asin

    let pages =
      ((try? FileManager.default.contentsOfDirectory(atPath: book + "/pages"))
      ?? []).filter { $0.hasSuffix(".png") }.count

    return BookState(
      capturedPages: pages,
      expectedPages: expectedPageCount(bookDir: book),
      transcribedChunks: chunkCount(at: book + "/content.json"),
      cleanedChunks: chunkCount(at: book + "/content.clean.json"))
  }

  /// How many content pages the extractor recorded for this book.
  private func expectedPageCount(bookDir: String) -> Int? {
    guard let data = FileManager.default.contents(atPath: bookDir + "/metadata.json"),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let nav = root["nav"] as? [String: Any],
      let total = nav["totalNumContentPages"] as? Int,
      total > 0
    else { return nil }

    return total
  }

  private func chunkCount(at path: String) -> Int {
    guard let data = FileManager.default.contents(atPath: path),
      let chunks = try? JSONSerialization.jsonObject(with: data) as? [Any]
    else { return 0 }

    return chunks.count
  }

  /// Deliver events to `handle` in the order the pipeline emitted them.
  ///
  /// The runner's callback fires on a background queue. Hopping to the main
  /// actor with one unstructured Task per event gives no ordering guarantee,
  /// so log lines interleave and a stale update can land after the job has
  /// already finished.
  private func consumingEvents(
    job: ExportJob?,
    _ body: (@escaping @Sendable (ExportEvent) -> Void) async throws -> Void
  ) async throws {
    let (stream, continuation) = AsyncStream<ExportEvent>.makeStream()
    let consumer = Task { @MainActor [weak self] in
      for await event in stream {
        self?.handle(event, job: job)
      }
    }

    defer { continuation.finish() }

    do {
      try await body { continuation.yield($0) }
    } catch {
      continuation.finish()
      await consumer.value
      throw error
    }

    continuation.finish()
    await consumer.value
  }

  // MARK: - Events

  private func handle(_ event: ExportEvent, job: ExportJob?) {
    switch event {
    case .page(let index, _, let total):
      if let job, job.isActive, case .running(let step, _, _) = job.state {
        job.state = .running(step: step, completed: index + 1, total: total)
        job.timeline.advance(step, completed: index + 1, total: total)
      }
    case .stepStart(let step):
      if let job, job.isActive {
        job.state = .running(step: step, completed: 0, total: 0)
        job.timeline.start(step)
      }
      append("→ \(step.displayName)")
    case .stepDone(let step):
      job?.timeline.finish(step)
      append("✓ \(step.displayName)")
    case .sessionExpired:
      needsSignIn = true
      append("Amazon session expired")
    case .log(let message):
      append(message)
    case .error(let message):
      append("error: \(message)")
    case .done(let outFile):
      if let outFile, job != nil {
        producedArtifacts.append(outFile)
      }
      append(outFile.map { "wrote \($0)" } ?? "done")
    case .bookMeta(_, let title, _):
      append(title)
    }
  }

  private func append(_ line: String) {
    log.append(line)
    if log.count > 2000 { log.removeFirst(log.count - 2000) }
  }
}

extension ExportJob {
  /// Whether progress events should still move this job's state.
  ///
  /// Events arrive asynchronously, so a late one can land after the job has
  /// already finished or failed.
  var isActive: Bool {
    switch state {
    case .queued, .running: true
    case .finished, .failed, .cancelled: false
    }
  }

  /// Done with, one way or another.
  var isFinished: Bool {
    switch state {
    case .finished, .failed, .cancelled: true
    case .queued, .running: false
    }
  }
}
