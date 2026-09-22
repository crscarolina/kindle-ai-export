import Foundation
import KindleExportCore
import Observation

/// SwiftUI declares its own `LibraryItem`, so refer to ours by an alias.
typealias Book = KindleExportCore.LibraryItem

/// Persisted preferences. The password lives in the Keychain, not here.
@Observable
@MainActor
final class AppSettings {
  /// An explicit checkout chosen in Settings. Empty means use the bundled
  /// pipeline, which is the normal case.
  var repoPathOverride: String {
    didSet { defaults.set(repoPathOverride, forKey: "repoPath") }
  }
  var amazonEmail: String {
    didSet { defaults.set(amazonEmail, forKey: "amazonEmail") }
  }
  var destination: String {
    didSet { defaults.set(destination, forKey: "destination") }
  }

  private let defaults = UserDefaults.standard

  init() {
    let defaults = UserDefaults.standard
    repoPathOverride = defaults.string(forKey: "repoPath") ?? ""
    amazonEmail = defaults.string(forKey: "amazonEmail") ?? ""
    destination =
      defaults.string(forKey: "destination")
      ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        .first?.path(percentEncoded: false) ?? ""
  }

  var amazonPassword: String {
    get { Keychain.get(account: amazonEmail) ?? "" }
    set { try? Keychain.set(newValue, account: amazonEmail) }
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

  /// Credentials for the child process. Passed as environment, never argv.
  var credentials: [String: String] {
    var env: [String: String] = [:]
    if !amazonEmail.isEmpty { env["AMAZON_EMAIL"] = amazonEmail }
    if !amazonPassword.isEmpty { env["AMAZON_PASSWORD"] = amazonPassword }
    return env
  }

  /// Re-key the stored password when the email changes.
  func moveCredential(from old: String, to new: String) {
    guard old != new, !old.isEmpty else { return }
    guard let secret = Keychain.get(account: old) else { return }

    try? Keychain.set(secret, account: new)
    try? Keychain.delete(account: old)
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
  var status: String?
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
          credentials: settings.credentials,
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
          credentials: settings.credentials,
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
      ExportJob(item: item, options: options, destination: settings.destination))
    startPumpIfNeeded()
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
            command, credentials: settings.credentials, onEvent: emit)
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
