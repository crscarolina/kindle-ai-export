import Foundation

/// A minimal assertion harness.
///
/// XCTest and Swift Testing both ship with Xcode rather than the Command Line
/// Tools, so `swift test` is unavailable on a machine that only has the CLT.
/// Rather than make a 10GB Xcode install a prerequisite for running the
/// suite, the tests are an ordinary executable built on this.
public struct TestHarness {
  private var passed = 0
  private var failures: [String] = []

  public init() {}

  public mutating func expect(
    _ condition: Bool,
    _ description: String,
    file: StaticString = #file,
    line: UInt = #line
  ) {
    if condition {
      passed += 1
    } else {
      failures.append("\(description) (\(file):\(line))")
    }
  }

  public mutating func expectEqual<T: Equatable>(
    _ actual: T,
    _ expected: T,
    _ description: String,
    file: StaticString = #file,
    line: UInt = #line
  ) {
    if actual == expected {
      passed += 1
    } else {
      failures.append(
        "\(description): expected \(expected), got \(actual) (\(file):\(line))")
    }
  }

  /// Print a summary and exit non-zero if anything failed.
  public func finish(suite: String) -> Never {
    for failure in failures {
      FileHandle.standardError.write(Data("FAIL \(failure)\n".utf8))
    }

    print("\(suite): \(passed) passed, \(failures.count) failed")
    exit(failures.isEmpty ? 0 : 1)
  }
}
