import AVFoundation
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
    try pitchPreservingPlayback()
    try conservativeTrimming()
    try wavRoundTripAndValidation()
    print("3 Swift audio checks passed (offline playback rates/pitch, trimming, WAV validation).")
  }

  static func pitchPreservingPlayback() throws {
    // Offline rendering never opens the output device. Test the production graph, not a mock DSP.
    for speed: Float in [0.5, 1, 1.25, 1.5, 2] {
      let graph = try PlaybackGraph()
      for invalid: Float in [.nan, .infinity, 0, 0.49, 2.01] {
        try rejects { try graph.setSpeed(invalid) }
      }
      try graph.setSpeed(speed)
      try graph.engine.enableManualRenderingMode(
        .offline, format: graph.format, maximumFrameCount: 1024)
      let tone = (0..<(PCM.rate * 4)).map { index in
        Float(0.25 * sin(2 * Double.pi * 440 * Double(index) / Double(PCM.rate)))
      }
      graph.player.scheduleBuffer(try graph.buffer(tone))
      try graph.engine.start()
      graph.player.play()
      defer { graph.engine.stop() }
      let output = AVAudioPCMBuffer(pcmFormat: graph.format, frameCapacity: 1024)!
      var samples: [Float] = []
      let target = Int((4 / Double(speed) + 0.6) * Double(PCM.rate))
      var attempts = 0
      while samples.count < target {
        attempts += 1
        try expect(attempts < 1000, "Offline render must make progress")
        let status = try graph.engine.renderOffline(1024, to: output)
        if status == .cannotDoInCurrentContext { continue }
        try expect(status == .success, "Offline rendering succeeds")
        samples.append(
          contentsOf: UnsafeBufferPointer(
            start: output.floatChannelData![0], count: Int(output.frameLength)))
      }
      let first = samples.firstIndex { abs($0) > 0.02 }!
      let last = samples.lastIndex { abs($0) > 0.02 }!
      let duration = Double(last - first) / Double(PCM.rate)
      try expect(
        abs(duration - 4 / Double(speed)) < 0.12, "Playback duration at \(speed)x: \(duration)")
      let begin = first + (last - first) / 4
      let end = first + (last - first) * 3 / 4
      let crossings = ((begin + 1)..<end).filter { samples[$0 - 1] <= 0 && samples[$0] > 0 }.count
      let frequency = Double(crossings) * Double(PCM.rate) / Double(end - begin)
      try expect(abs(frequency - 440) < 8, "Preserve 440 Hz pitch at \(speed)x: \(frequency)")
      graph.reset()
    }
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
