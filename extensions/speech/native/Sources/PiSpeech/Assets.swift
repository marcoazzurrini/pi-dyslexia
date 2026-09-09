import CryptoKit
import Foundation
import SpeechCore

struct AssetLock: Decodable {
  struct Asset: Decodable {
    let path: String
    let size: Int
    let sha256: String
  }
  let revision: String
  let files: [Asset]

  static let voices: Set<String> = ["af_heart", "af_bella", "am_michael", "bf_emma", "bm_george"]

  static func check(verify: Bool) throws {
    guard let manifest = Bundle.module.url(forResource: "assets", withExtension: "json"),
      let configured = ProcessInfo.processInfo.environment["PI_DYSLEXIA_NATIVE_HOME"],
      FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.path
        == URL(fileURLWithPath: configured).standardizedFileURL.path
    else {
      throw SpeechError.missingAssets
    }
    let assets = try JSONDecoder().decode(AssetLock.self, from: Data(contentsOf: manifest))
    let root = URL(fileURLWithPath: configured).appendingPathComponent(".cache/fluidaudio/Models")
    for asset in assets.files {
      let url = root.appendingPathComponent(asset.path)
      let metadata = try url.resourceValues(forKeys: [
        .fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey,
      ])
      guard metadata.isRegularFile == true, metadata.isSymbolicLink != true,
        metadata.fileSize == asset.size
      else {
        throw SpeechError.missingAssets
      }
      if verify {
        let hash = SHA256.hash(data: try Data(contentsOf: url, options: .mappedIfSafe))
        guard hash.map({ String(format: "%02x", $0) }).joined() == asset.sha256 else {
          throw SpeechError.missingAssets
        }
      }
    }
  }
}
