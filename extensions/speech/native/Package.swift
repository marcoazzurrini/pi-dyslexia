// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "PiSpeech",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "pi-speech", targets: ["PiSpeech"]),
    .executable(name: "speech-core-tests", targets: ["SpeechCoreTests"]),
  ],
  dependencies: [
    .package(
      url: "https://github.com/FluidInference/FluidAudio.git",
      revision: "9dfb81b9535e119f855f9ec9c98308ea6076cc95"
    )
  ],
  targets: [
    .target(name: "SpeechCore"),
    .executableTarget(
      name: "PiSpeech",
      dependencies: ["SpeechCore", .product(name: "FluidAudio", package: "FluidAudio")],
      resources: [.copy("Resources/assets.json")]
    ),
    // Apple's standalone command-line tools omit XCTest/Testing modules.
    // This executable keeps model-free tests runnable without full Xcode.
    .executableTarget(
      name: "SpeechCoreTests", dependencies: ["SpeechCore"], path: "Tests/SpeechCoreTests"),
  ]
)
