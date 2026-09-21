// swift-tools-version: 6.0
import PackageDescription

// XCTest and Swift Testing both ship with Xcode, not the Command Line Tools,
// so `swift test` cannot run here. The test suite is a plain executable
// instead: `swift run KindleExportCoreTests`.
let package = Package(
  name: "KindleExport",
  platforms: [.macOS(.v14)],
  targets: [
    // The app shell. Kept thin so everything worth testing lives in Core.
    .executableTarget(
      name: "KindleExport",
      dependencies: ["KindleExportCore"]
    ),
    .target(name: "KindleExportCore"),
    .executableTarget(
      name: "KindleExportCoreTests",
      dependencies: ["KindleExportCore"]
    )
  ]
)
