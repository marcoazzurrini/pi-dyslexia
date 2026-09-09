import Darwin
import FluidAudio
import Foundation
import SpeechCore

@main
struct Entry {
  static func main() async {
    umask(0o077)
    let writer = ProtocolWriter()
    // Keep all third-party output away from the protocol and user text logs.
    let quiet = open("/dev/null", O_WRONLY)
    guard quiet >= 0 else { exit(1) }
    dup2(quiet, STDOUT_FILENO)
    dup2(quiet, STDERR_FILENO)
    close(quiet)
    do {
      let arguments = Array(CommandLine.arguments.dropFirst())
      if arguments == ["--player"] {
        try runPlayer(writer: writer)
        return
      }
      try AssetLock.check(verify: arguments != ["--check"])
      if arguments == ["--check"] || arguments == ["--verify"] {
        writer.send(["ready": true, "albert": "cpuAndGPU", "playbackRate": 1])
        return
      }
      guard arguments.count == 1 else { throw SpeechError.invalidRequest }
      let directory = URL(fileURLWithPath: arguments[0]).resolvingSymlinksInPath()
      var isDirectory: ObjCBool = false
      guard FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory),
        isDirectory.boolValue
      else { throw SpeechError.invalidRequest }
      ModelHub.offlineMode = true
      // Core ML's CPU/Neural Engine default falls back to CPU for ALBERT on
      // the tested M1 Max. Allow GPU execution only for this stage; retain the
      // upstream routing for every other stage. See the performance report.
      var units = KokoroAneComputeUnits.default
      units.albert = .cpuAndGPU
      let manager = KokoroAneManager(computeUnits: units)
      try await manager.initialize(preloadVoices: AssetLock.voices)
      while let line = readLine() {
        var identity: Any = NSNull()
        do {
          let request = try Request.parse(line)
          identity = request.id
          guard let text = request.text,
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            text.count <= 2000, let voice = request.voice,
            request.speed == nil
          else {
            throw SpeechError.invalidRequest
          }
          guard AssetLock.voices.contains(voice) else { throw SpeechError.unsupportedVoice }
          let phonemes = try await manager.phonemes(for: text)
          guard !phonemes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SpeechError.invalidAudio
          }
          let samples = try await synthesize(phonemes, manager: manager, voice: voice)
          let wav = try PCM.encode(samples)
          try wav.write(to: directory.appendingPathComponent("\(request.id).wav"), options: .atomic)
          writer.send(["id": request.id, "seconds": Double(wav.count - 44) / Double(PCM.rate * 2)])
        } catch {
          // Never include localized errors, text, phonemes, or filesystem paths.
          writer.send([
            "id": identity, "error": (error as? SpeechError)?.rawValue ?? "SynthesisFailed",
          ])
        }
      }
    } catch {
      writer.send(["error": (error as? SpeechError)?.rawValue ?? "WorkerFailed"])
      exit(1)
    }
  }

  static func synthesize(
    _ phonemes: String, manager: KokoroAneManager, voice: String
  ) async throws -> [Float] {
    if phonemes.count <= 510 {
      do {
        let result = try await manager.synthesizeFromPhonemesDetailed(
          phonemes, voice: voice, speed: 1)
        guard result.sampleRate == PCM.rate else { throw SpeechError.invalidAudio }
        return result.samples
      } catch KokoroAneError.acousticFramesExceedCap {
        // Retry shorter complete words, never truncate audio or phonemes.
      }
    }
    let characters = Array(phonemes)
    let middle = characters.count / 2
    guard
      let boundary = characters.indices.filter({
        characters[$0].isWhitespace && $0 > 0 && $0 < characters.count - 1
      })
      .min(by: { abs($0 - middle) < abs($1 - middle) })
    else { throw SpeechError.oversizedInput }
    let left = try await synthesize(
      String(characters[..<boundary]), manager: manager, voice: voice)
    let right = try await synthesize(
      String(characters[(boundary + 1)...]), manager: manager, voice: voice)
    guard left.count + right.count <= PCM.byteLimit / 2 else { throw SpeechError.invalidAudio }
    return left + right
  }
}
