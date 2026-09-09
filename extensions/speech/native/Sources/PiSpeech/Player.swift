import AVFoundation
import Foundation
import SpeechCore

/// All graph and lifecycle state lives on one queue. Audio callbacks only enqueue events.
private final class PlayerOutput: @unchecked Sendable {
  private struct Active {
    let id: Int
    let token: Int
    // Retain the buffer until downstream playback completes, not just source consumption.
    let buffer: AVAudioPCMBuffer
    var paused: Bool
    var reported = false
    var completed = false
  }

  private let graph: PlaybackGraph
  private let writer: ProtocolWriter
  private let queue = DispatchQueue(label: "pi-speech.playback")
  private var timer: DispatchSourceTimer?
  private var observer: NSObjectProtocol?
  private var active: Active?
  private var token = 0
  private var closed = false

  init(writer: ProtocolWriter) throws {
    self.writer = writer
    graph = try PlaybackGraph()
  }

  func start() throws {
    try queue.sync {
      // Prime the complete graph with silence. Readiness includes the time-pitch unit and device.
      let silence = try graph.buffer([Float](repeating: 0, count: 240))
      graph.player.scheduleBuffer(silence, completionCallbackType: .dataPlayedBack) {
        [weak self] _ in
        self?.ready()
      }
      graph.engine.prepare()
      try graph.engine.start()
      graph.player.play()
      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now(), repeating: .milliseconds(5))
      timer.setEventHandler { [weak self] in self?.report() }
      self.timer = timer
      timer.resume()
      observer = NotificationCenter.default.addObserver(
        forName: .AVAudioEngineConfigurationChange, object: graph.engine, queue: nil
      ) { [weak self] _ in
        self?.deviceChanged()
      }
    }
  }

  private func ready() {
    queue.async { [self] in
      if !closed { writer.send(["event": "ready"]) }
    }
  }

  private func deviceChanged() {
    queue.async { [self] in
      if !closed { writer.send(["error": "AudioDeviceChanged"]) }
    }
  }

  private func completed(_ token: Int) {
    queue.async { [self] in
      guard !closed, active?.token == token else { return }
      active?.completed = true
      report()
    }
  }

  private func report() {
    guard var current = active, !current.paused else { return }
    if !current.reported {
      let rendered = graph.player.lastRenderTime.flatMap {
        graph.player.playerTime(forNodeTime: $0)
      }
      guard current.completed || (rendered?.sampleTime ?? 0) > 0 else { return }
      current.reported = true
      // This is a render acknowledgement, not a microphone measurement.
      let delay = max(
        0, (graph.timePitch.latency + graph.engine.outputNode.presentationLatency) * 1000)
      writer.send(["id": current.id, "event": "started", "output_delay_ms": delay])
    }
    active = current
    if current.completed {
      active = nil
      writer.send(["id": current.id, "event": "done"])
    }
  }

  func handle(_ request: Request) throws {
    // File I/O and validation never run on the audio callback.
    let buffer: AVAudioPCMBuffer?
    if request.action == "play" {
      guard let path = request.path else { throw SpeechError.invalidRequest }
      let url = URL(fileURLWithPath: path)
      let metadata = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
      guard metadata.isRegularFile == true, let size = metadata.fileSize,
        size <= PCM.byteLimit + 4096
      else { throw SpeechError.invalidAudio }
      buffer = try graph.buffer(PCM.decode(Data(contentsOf: url)))
    } else {
      buffer = nil
    }
    try queue.sync {
      guard !closed else { throw SpeechError.invalidRequest }
      switch request.action {
      case "play":
        guard active == nil, let buffer, let speed = request.speed else {
          throw SpeechError.invalidRequest
        }
        guard speed.isFinite, (0.5...2).contains(speed) else { throw SpeechError.invalidRequest }
        graph.reset()
        try graph.setSpeed(speed)
        token += 1
        let scheduledToken = token
        let paused = request.paused == true
        if paused { graph.engine.pause() }
        active = Active(id: request.id, token: scheduledToken, buffer: buffer, paused: paused)
        graph.player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) {
          [weak self] _ in
          self?.completed(scheduledToken)
        }
        if !paused { graph.player.play() }
      case "rate":
        guard let speed = request.speed, speed.isFinite, (0.5...2).contains(speed) else {
          throw SpeechError.invalidRequest
        }
        if active?.id == request.id { try graph.setSpeed(speed) }
      case "pause":
        if active?.id == request.id {
          // Freeze the whole graph, including audio buffered inside the time-pitch unit.
          graph.engine.pause()
          active?.paused = true
        }
      case "resume":
        if active?.id == request.id {
          try graph.engine.start()
          if !graph.player.isPlaying { graph.player.play() }
          active?.paused = false
          report()
        }
      case "stop":
        if active?.id == request.id {
          // Invalidate callbacks before stop, which can itself fire completion callbacks.
          active = nil
          graph.reset()
          if !graph.engine.isRunning { try graph.engine.start() }
        }
      default:
        throw SpeechError.invalidRequest
      }
    }
  }

  func close() {
    queue.sync {
      closed = true
      active = nil
      if let observer { NotificationCenter.default.removeObserver(observer) }
      timer?.cancel()
      graph.reset()
      graph.engine.stop()
    }
  }
}

func runPlayer(writer: ProtocolWriter) throws {
  let output = try PlayerOutput(writer: writer)
  defer { output.close() }
  try output.start()
  while let line = readLine() {
    var identity: Any = NSNull()
    do {
      let request = try Request.parse(line)
      identity = request.id
      try output.handle(request)
    } catch {
      writer.send(["id": identity, "error": "PlaybackFailed"])
    }
  }
}
