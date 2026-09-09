import AVFoundation
import Foundation

/// Persistent, pitch-preserving playback. The owner serializes all graph changes.
public final class PlaybackGraph {
  public let engine = AVAudioEngine()
  public let player = AVAudioPlayerNode()
  public let timePitch = AVAudioUnitTimePitch()
  public let format: AVAudioFormat

  public init() throws {
    guard let format = AVAudioFormat(standardFormatWithSampleRate: Double(PCM.rate), channels: 1)
    else { throw SpeechError.invalidAudio }
    self.format = format
    engine.attach(player)
    engine.attach(timePitch)
    engine.connect(player, to: timePitch, format: format)
    engine.connect(timePitch, to: engine.mainMixerNode, format: format)
    timePitch.pitch = 0
    timePitch.rate = 1
  }

  public func setSpeed(_ speed: Float) throws {
    guard speed.isFinite, (0.5...2).contains(speed) else { throw SpeechError.invalidRequest }
    timePitch.rate = speed
  }

  public func buffer(_ samples: [Float]) throws -> AVAudioPCMBuffer {
    guard !samples.isEmpty, samples.count <= PCM.byteLimit / 2,
      let buffer = AVAudioPCMBuffer(
        pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
      let output = buffer.floatChannelData?[0]
    else { throw SpeechError.invalidAudio }
    buffer.frameLength = buffer.frameCapacity
    samples.withUnsafeBufferPointer { source in
      output.update(from: source.baseAddress!, count: source.count)
    }
    return buffer
  }

  /// Stop invalidates scheduled buffers. Reset the effect so cancelled speech cannot leak on replay.
  public func reset() {
    player.stop()
    timePitch.reset()
  }
}
