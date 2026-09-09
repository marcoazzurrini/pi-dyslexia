import Foundation
import SpeechCore

@main
struct AudioTests {
  enum Failure: Error {
    case assertion(String)
    case expectedError
  }

  static func expect(_ condition: Bool, _ message: String) throws {
    if !condition { throw Failure.assertion(message) }
  }

  static func rejects<T>(_ operation: () throws -> T) throws {
    do { _ = try operation() } catch is SpeechError { return }
    throw Failure.expectedError
  }

  static func main() throws {
    try pausePreservesPosition()
    try conservativeTrimming()
    try wavRoundTripAndValidation()
    print("3 Swift audio checks passed (pause/resume, trimming, WAV validation).")
  }

  static func pausePreservesPosition() throws {
    var buffer = PlaybackBuffer(samples: [1, 2, 3])
    var out = [Float](repeating: 9, count: 2)
    let first = out.withUnsafeMutableBufferPointer { buffer.read(into: $0) }
    try expect(first.started && !first.done && out == [1, 2], "First buffer")
    buffer.paused = true
    let paused = out.withUnsafeMutableBufferPointer { buffer.read(into: $0) }
    try expect(!paused.started && !paused.done && out == [0, 0], "Paused output")
    try expect(buffer.position == 2, "Pause must not advance position")
    buffer.paused = false
    let last = out.withUnsafeMutableBufferPointer { buffer.read(into: $0) }
    try expect(!last.started && last.done && out == [3, 0], "Resume at retained position")
  }

  static func conservativeTrimming() throws {
    let samples = [Int16](repeating: 0, count: 1000) + [1, 0, -1, 32767]
    try expect(PCM.trim(samples) == Array(samples[520...]), "Retain 20 ms")
    try expect(PCM.trim(Array(samples[900...])) == Array(samples[900...]), "Never cut speech")
    try expect(
      PCM.trim([Int16](repeating: 0, count: 1000)).count == 1000, "Retain all-zero samples")
  }

  static func wavRoundTripAndValidation() throws {
    let wav = try PCM.encode([0, 0.5, -1, 2])
    try expect(wav.count == 52, "WAV size")
    try expect(
      Array(wav.suffix(8)) == [0, 0, 255, 63, 1, 128, 255, 127],
      "Bulk encoding preserves exact little-endian PCM bytes")
    let decoded = try PCM.decode(wav)
    try expect(decoded.count == 4 && abs(decoded[1] - 0.5) < 0.0001, "PCM round trip")
    try expect(decoded[2] < -0.99 && decoded[3] > 0.99, "Clip out-of-range samples")
    try rejects { try PCM.encode([]) }
    try rejects { try PCM.encode([.nan]) }
    try rejects { try PCM.encode([.infinity]) }
    try rejects { try PCM.decode(wav.dropLast()) }
    var stereo = wav
    stereo[22] = 2
    try rejects { try PCM.decode(stereo) }
    var wrongRate = wav
    wrongRate[24] = 0
    try rejects { try PCM.decode(wrongRate) }
  }
}
