import Foundation
import SpeechCore

struct Request: Decodable {
  let id: Int
  let text: String?
  let voice: String?
  let speed: Float?
  let action: String?
  let path: String?
  let paused: Bool?

  static func parse(_ line: String) throws -> Request {
    guard line.utf8.count <= 16_384 else { throw SpeechError.invalidRequest }
    let request = try JSONDecoder().decode(Request.self, from: Data(line.utf8))
    guard request.id >= 0, request.id <= 9_007_199_254_740_991 else {
      throw SpeechError.invalidRequest
    }
    return request
  }
}

/// Protocol writes never run on the audio render thread. Library stdout/stderr
/// are redirected separately so third-party messages cannot corrupt JSON or log text.
final class ProtocolWriter: @unchecked Sendable {
  private let output = FileHandle(fileDescriptor: dup(STDOUT_FILENO), closeOnDealloc: true)
  private let lock = NSLock()

  func send(_ message: [String: Any]) {
    guard let bytes = try? JSONSerialization.data(withJSONObject: message, options: [.sortedKeys])
    else { return }
    lock.lock()
    defer { lock.unlock() }
    do {
      try output.write(contentsOf: bytes + Data([10]))
    } catch {
      exit(1)
    }
  }
}
