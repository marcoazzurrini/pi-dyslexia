import AVFoundation
import Foundation
import SpeechCore

/// Shared state is bounded. The render callback only copies PCM and sets flags.
/// A separate timer serializes acknowledgements; stdin never runs in the callback.
private final class RenderState: @unchecked Sendable {
  final class Active {
    let id: Int
    var buffer: PlaybackBuffer
    var started = false
    var reported = false
    var done = false
    init(id: Int, samples: [Float], paused: Bool) {
      self.id = id
      buffer = PlaybackBuffer(samples: samples, paused: paused)
    }
  }
  let lock = NSLock()
  var ready = false
  var reportedReady = false
  var active: Active?

  func render(frames: Int, list: UnsafeMutablePointer<AudioBufferList>) {
    let buffers = UnsafeMutableAudioBufferListPointer(list)
    // The source format is non-interleaved mono Float32 at 24 kHz.
    for buffer in buffers {
      if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
    }
    guard lock.try() else { return }
    defer { lock.unlock() }
    ready = true
    guard let active, !active.done, let data = buffers.first?.mData else { return }
    let output = UnsafeMutableBufferPointer(
      start: data.assumingMemoryBound(to: Float.self), count: frames)
    let event = active.buffer.read(into: output)
    active.started = active.started || event.started
    active.done = event.done
  }

  func report(to writer: ProtocolWriter, delay: Double) {
    lock.lock()
    let becameReady = ready && !reportedReady
    reportedReady = reportedReady || ready
    let began = active.flatMap { $0.started && !$0.reported ? $0.id : nil }
    if began != nil { active?.reported = true }
    let ended = active.flatMap { $0.done ? $0.id : nil }
    if ended != nil { active = nil }
    lock.unlock()
    if becameReady { writer.send(["event": "ready"]) }
    if let began { writer.send(["id": began, "event": "started", "output_delay_ms": delay]) }
    if let ended { writer.send(["id": ended, "event": "done"]) }
  }
}

func runPlayer(writer: ProtocolWriter) throws {
  let engine = AVAudioEngine()
  let state = RenderState()
  guard let format = AVAudioFormat(standardFormatWithSampleRate: Double(PCM.rate), channels: 1)
  else {
    throw SpeechError.invalidAudio
  }
  let source = AVAudioSourceNode(format: format) { _, _, frames, buffers in
    state.render(frames: Int(frames), list: buffers)
    return noErr
  }
  engine.attach(source)
  engine.connect(source, to: engine.mainMixerNode, format: format)
  engine.prepare()
  try engine.start()
  let downstreamDelay = max(0, engine.outputNode.presentationLatency * 1000)
  let queue = DispatchQueue(label: "pi-speech.acknowledgements")
  let timer = DispatchSource.makeTimerSource(queue: queue)
  timer.schedule(deadline: .now(), repeating: .milliseconds(5))
  timer.setEventHandler { state.report(to: writer, delay: downstreamDelay) }
  timer.resume()
  // Do not silently claim playback continues after a device reconfiguration.
  let observer = NotificationCenter.default.addObserver(
    forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
  ) { _ in
    writer.send(["error": "AudioDeviceChanged"])
  }
  defer {
    NotificationCenter.default.removeObserver(observer)
    timer.cancel()
    queue.sync {}
    engine.stop()
  }
  while let line = readLine() {
    var identity: Any = NSNull()
    do {
      let request = try Request.parse(line)
      identity = request.id
      switch request.action {
      case "play":
        guard let path = request.path else { throw SpeechError.invalidRequest }
        let url = URL(fileURLWithPath: path)
        let metadata = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard metadata.isRegularFile == true, let size = metadata.fileSize,
          size <= PCM.byteLimit + 4096
        else { throw SpeechError.invalidAudio }
        let samples = try PCM.decode(Data(contentsOf: url))
        let active = RenderState.Active(
          id: request.id, samples: samples, paused: request.paused == true)
        state.lock.lock()
        if state.active != nil {
          state.lock.unlock()
          throw SpeechError.invalidRequest
        }
        state.active = active
        state.lock.unlock()
      case "pause", "resume", "stop":
        state.lock.lock()
        if state.active?.id == request.id {
          if request.action == "stop" {
            state.active = nil
          } else {
            state.active?.buffer.paused = request.action == "pause"
          }
        }
        state.lock.unlock()
      default:
        throw SpeechError.invalidRequest
      }
    } catch {
      writer.send(["id": identity, "error": "PlaybackFailed"])
    }
  }
}
