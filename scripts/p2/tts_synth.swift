// Reading "listen to the text" (SPEC §5.A): synthesize with a macOS voice and record when each word starts.
// Driven by scripts/p2/tts.py, which compiles this file to build/tts-synth.
//
// Usage: tts-synth <job.json> <out dir>
//   job:  {"voice": "<voice identifier>", "items": [{"id": "CE-1-01", "parts": [{"text": "...", "pause": 0.6}]}]}
//   out:  <id>.wav (mono, 16 bit) and <id>.json
//         {"sr": 22050, "frames": N, "parts": [{"at": first frame, "frames": n, "words": [[utf16 loc, utf16 len, frame], ...]}]}
//         "pause" is the silence written after a part; word frames count from the start of the file.
//
// Word markers come through the delegate (willSpeak marker), also while writing to buffers; their
// byteSampleOffset is in bytes of the buffers delivered (Float32 mono: 4 per frame).
import AVFoundation

struct Part: Decodable { let text: String; let pause: Double }
struct Item: Decodable { let id: String; let parts: [Part] }
struct Job: Decodable { let voice: String; let items: [Item] }

final class Recorder: NSObject, AVSpeechSynthesizerDelegate {
  let lock = NSLock()
  var marks: [(loc: Int, len: Int, byte: Int)] = []
  func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeak m: AVSpeechSynthesisMarker, utterance u: AVSpeechUtterance) {
    guard m.mark == .word else { return }
    lock.lock()
    marks.append((m.textRange.location, m.textRange.length, Int(m.byteSampleOffset)))
    lock.unlock()
  }
}

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: tts-synth <job.json> <out dir>\n".data(using: .utf8)!)
  exit(2)
}
let job = try JSONDecoder().decode(Job.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
let outDir = URL(fileURLWithPath: args[2])
guard let voice = AVSpeechSynthesisVoice(identifier: job.voice) else {
  FileHandle.standardError.write("voice not installed: \(job.voice)\n".data(using: .utf8)!)
  exit(1)
}
let synth = AVSpeechSynthesizer()
let rec = Recorder()
synth.delegate = rec

/** Audio buffers of one utterance and its word markers (frames from the utterance start). */
func speak(_ text: String) -> ([AVAudioPCMBuffer], [[Int]]) {
  let u = AVSpeechUtterance(string: text)
  u.voice = voice
  u.preUtteranceDelay = 0
  u.postUtteranceDelay = 0
  let lock = NSLock()
  var bufs: [AVAudioPCMBuffer] = []
  var done = false
  rec.lock.lock(); rec.marks = []; rec.lock.unlock()
  synth.write(u) { b in
    guard let p = b as? AVAudioPCMBuffer else { return }
    lock.lock(); defer { lock.unlock() }
    if p.frameLength == 0 { done = true } else { bufs.append(p) }
  }
  let t0 = Date()
  while true {
    lock.lock(); let d = done; lock.unlock()
    if d || Date().timeIntervalSince(t0) > 120 { break }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.002))
  }
  RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01)) // markers still queued on the run loop
  let bytesPerFrame = Int(bufs.first?.format.streamDescription.pointee.mBytesPerFrame ?? 4)
  rec.lock.lock(); let marks = rec.marks; rec.lock.unlock()
  return (bufs, marks.map { [$0.loc, $0.len, $0.byte / max(1, bytesPerFrame)] })
}

for item in job.items {
  var file: AVAudioFile?
  var format: AVAudioFormat?
  var frames = 0
  var parts: [[String: Any]] = []
  func write(_ b: AVAudioPCMBuffer) throws {
    if file == nil {
      let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: b.format.sampleRate,
                                     AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false]
      file = try AVAudioFile(forWriting: outDir.appendingPathComponent("\(item.id).wav"), settings: settings,
                             commonFormat: b.format.commonFormat, interleaved: false)
      format = b.format
    }
    try file!.write(from: b)
    frames += Int(b.frameLength)
  }
  func silence(_ seconds: Double) throws {
    guard let f = format, seconds > 0 else { return }
    let n = AVAudioFrameCount(seconds * f.sampleRate)
    let b = AVAudioPCMBuffer(pcmFormat: f, frameCapacity: n)!
    b.frameLength = n // zero-filled
    try write(b)
  }
  for part in item.parts {
    let at = frames
    let (bufs, marks) = part.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? ([], []) : speak(part.text)
    for b in bufs { try write(b) }
    let n = frames - at
    parts.append(["at": at, "frames": n, "words": marks.map { [$0[0], $0[1], at + min($0[2], n)] }])
    try silence(part.pause)
  }
  let sr = Int(format?.sampleRate ?? 22050)
  file = nil // closes the wav (the header is written on deinit)
  let meta: [String: Any] = ["sr": sr, "frames": frames, "parts": parts]
  try JSONSerialization.data(withJSONObject: meta).write(to: outDir.appendingPathComponent("\(item.id).json"))
  print(item.id, String(format: "%.1f", Double(frames) / Double(sr)))
  fflush(stdout)
}
