import Foundation

public enum SpeechError: String, Error {
  case invalidRequest, invalidAudio, missingAssets, unsupportedVoice, oversizedInput
}

/// Strict 24 kHz mono PCM16 WAV boundary shared by synthesis and playback.
public enum PCM {
  public static let rate = 24_000
  public static let byteLimit = 32 * 1024 * 1024

  public static func trim(_ samples: [Int16]) -> [Int16] {
    guard let first = samples.firstIndex(where: { $0 != 0 }) else { return samples }
    return Array(samples[max(0, first - 480)...])
  }

  public static func encode(_ floats: [Float]) throws -> Data {
    guard !floats.isEmpty, floats.count <= byteLimit / 2,
      floats.allSatisfy({ $0.isFinite })
    else { throw SpeechError.invalidAudio }
    let samples = trim(floats.map { Int16(max(-1, min(1, $0)) * 32767) }).map(\.littleEndian)
    let body = samples.withUnsafeBytes { Data($0) }
    var wav = Data("RIFF".utf8)
    wav.appendLE(UInt32(body.count + 36))
    wav.append(Data("WAVEfmt ".utf8))
    wav.appendLE(UInt32(16))
    wav.appendLE(UInt16(1))
    wav.appendLE(UInt16(1))
    wav.appendLE(UInt32(rate))
    wav.appendLE(UInt32(rate * 2))
    wav.appendLE(UInt16(2))
    wav.appendLE(UInt16(16))
    wav.append(Data("data".utf8))
    wav.appendLE(UInt32(body.count))
    wav.append(body)
    return wav
  }

  public static func decode(_ wav: Data) throws -> [Float] {
    guard wav.count >= 44, wav.count <= byteLimit + 4096,
      wav.prefix(4) == Data("RIFF".utf8),
      wav.subdata(in: 8..<12) == Data("WAVE".utf8),
      Int(wav.u32(4)) + 8 == wav.count
    else { throw SpeechError.invalidAudio }
    var offset = 12
    var validFormat = false
    var audio: Range<Int>?
    while offset + 8 <= wav.count {
      let count = Int(wav.u32(offset + 4))
      let start = offset + 8
      guard count <= wav.count - start else { throw SpeechError.invalidAudio }
      let tag = wav.subdata(in: offset..<(offset + 4))
      if tag == Data("fmt ".utf8) {
        guard count >= 16, wav.u16(start) == 1, wav.u16(start + 2) == 1,
          wav.u32(start + 4) == rate, wav.u32(start + 8) == rate * 2,
          wav.u16(start + 12) == 2, wav.u16(start + 14) == 16
        else {
          throw SpeechError.invalidAudio
        }
        validFormat = true
      } else if tag == Data("data".utf8) {
        guard audio == nil else { throw SpeechError.invalidAudio }
        audio = start..<(start + count)
      }
      offset = start + count + count % 2
    }
    guard offset == wav.count, validFormat, let audio, !audio.isEmpty,
      audio.count <= byteLimit, audio.count % 2 == 0
    else { throw SpeechError.invalidAudio }
    return stride(from: audio.lowerBound, to: audio.upperBound, by: 2).map {
      Float(Int16(bitPattern: wav.u16($0))) / 32768
    }
  }
}

extension Data {
  mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
    var little = value.littleEndian
    Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
  }
  func u16(_ index: Int) -> UInt16 { UInt16(self[index]) | UInt16(self[index + 1]) << 8 }
  func u32(_ index: Int) -> UInt32 { UInt32(u16(index)) | UInt32(u16(index + 2)) << 16 }
}
