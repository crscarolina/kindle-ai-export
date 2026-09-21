import Foundation
import KindleExportCore
import Observation

/// SwiftUI declares its own `LibraryItem`, so refer to ours by an alias.
typealias Book = KindleExportCore.LibraryItem

/// Persisted preferences. The password lives in the Keychain, not here.
@Observable
@MainActor
final class AppSettings {
  var repoPath: String {
    didSet { defaults.set(repoPath, forKey: "repoPath") }
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
    repoPath = defaults.string(forKey: "repoPath") ?? ""
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
    ["AMAZON_EMAIL": amazonEmail, "AMAZON_PASSWORD": amazonPassword]
  }

  var isConfigured: Bool {
    !repoPath.isEmpty
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
        ? "\(step.rawValue) \(completed)/\(total)" : "\(step.rawValue)…"
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
  var search = ""
  var selectedAsin: String?
  var jobs: [ExportJob] = []
  var log: [String] = []
  var status: String?
  var isBusy = false
  /// Set when Amazon's session lapses; pauses the queue rather than failing it.
  var needsSignIn = false

  var options = ExportOptions()

  private var pump: Task<Void, Never>?

  var filteredLibrary: [Book] {
    guard !search.isEmpty else { return library }
    return library.filter {
      $0.title.localizedCaseInsensitiveContains(search)
        || $0.authorLine.localizedCaseInsensitiveContains(search)
    }
  }

  var selectedItem: Book? {
    library.first { $0.asin == selectedAsin }
  }

  private var runner: CLIRunner { CLIRunner(config: settings.toolchain) }

  private var libraryCachePath: String {
    settings.workDir + "/library.json"
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
      try await runner.runScript(
        "src/list-library.ts",
        arguments: [
          "--user-data-dir", settings.sessionDir, "--out-file", out, "--json",
        ],
        credentials: settings.credentials
      ) { [weak self] event in
        Task { @MainActor in self?.handle(event, job: nil) }
      }

      loadCachedLibrary()
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
      try await runner.runScript(
        "src/sign-in.ts",
        arguments: ["--user-data-dir", settings.sessionDir, "--json"],
        credentials: settings.credentials
      ) { [weak self] event in
        Task { @MainActor in self?.handle(event, job: nil) }
      }
      needsSignIn = false
      status = "Signed in."
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

  func remove(_ job: ExportJob) {
    if case .running = job.state { return }
    jobs.removeAll { $0.id == job.id }
  }

  /// Runs jobs strictly one at a time.
  ///
  /// Chromium takes an exclusive lock on the shared profile directory, so a
  /// second concurrent extraction would simply fail to launch.
  private func startPumpIfNeeded() {
    guard pump == nil else { return }
    pump = Task { [weak self] in
      while let self, let job = await self.nextQueuedJob() {
        await self.run(job)
        if await self.needsSignIn { break }
      }
      await self?.clearPump()
    }
  }

  private func nextQueuedJob() -> ExportJob? {
    jobs.first { $0.state == .queued }
  }

  private func clearPump() {
    pump = nil
  }

  private func run(_ job: ExportJob) async {
    let state = inspect(asin: job.item.asin)
    let commands = ExportPlan.commands(
      asin: job.item.asin,
      options: job.options,
      state: state,
      workDir: settings.workDir,
      userDataDir: settings.sessionDir,
      destination: job.destination)

    for command in commands {
      job.state = .running(step: command.step, completed: 0, total: 0)
      do {
        try await runner.run(command, credentials: settings.credentials) {
          [weak self] event in
          Task { @MainActor in self?.handle(event, job: job) }
        }
      } catch CLIRunnerError.sessionExpired {
        needsSignIn = true
        job.state = .failed("Amazon session expired")
        status = "Queue paused — sign in again from Settings."
        return
      } catch {
        job.state = .failed(error.localizedDescription)
        return
      }
    }

    job.state = .finished
  }

  /// What already exists on disk for this book.
  private func inspect(asin: String) -> BookState {
    let fm = FileManager.default
    let book = settings.workDir + "/" + asin
    let pages = (try? fm.contentsOfDirectory(atPath: book + "/pages")) ?? []
    return BookState(
      hasPages: !pages.isEmpty,
      hasContent: fm.fileExists(atPath: book + "/content.json"),
      hasCleanedContent: fm.fileExists(atPath: book + "/content.clean.json"))
  }

  // MARK: - Events

  private func handle(_ event: ExportEvent, job: ExportJob?) {
    switch event {
    case .page(let index, _, let total):
      if let job, case .running(let step, _, _) = job.state {
        job.state = .running(step: step, completed: index + 1, total: total)
      }
    case .stepStart(let step):
      if let job { job.state = .running(step: step, completed: 0, total: 0) }
      append("→ \(step.rawValue)")
    case .stepDone(let step):
      append("✓ \(step.rawValue)")
    case .sessionExpired:
      needsSignIn = true
      append("Amazon session expired")
    case .log(let message):
      append(message)
    case .error(let message):
      append("error: \(message)")
    case .done(let outFile):
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
