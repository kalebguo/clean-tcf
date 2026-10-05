// OCR reading-question images with macOS Vision.
// Usage: ocr <out_dir> <image>...   → writes <out_dir>/<name>.json  [{text, x, y, w, h, conf}]
// Coordinates are normalized with origin at the TOP-left.
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: ocr <out_dir> <image>..."); exit(1) }
let outDir = URL(fileURLWithPath: args[1])

for path in args[2...] {
    let url = URL(fileURLWithPath: path)
    let out = outDir.appendingPathComponent(url.deletingPathExtension().lastPathComponent + ".json")
    if FileManager.default.fileExists(atPath: out.path) { continue }
    guard let img = NSImage(contentsOf: url),
          let src = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("skip \(path)\n".data(using: .utf8)!); continue
    }
    // Many "jpg" files are really PNGs with transparent areas; flatten onto white
    // so dark text on a transparent background stays visible to Vision.
    let ctx = CGContext(data: nil, width: src.width, height: src.height, bitsPerComponent: 8,
                        bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: src.width, height: src.height))
    ctx.draw(src, in: CGRect(x: 0, y: 0, width: src.width, height: src.height))
    let cg = ctx.makeImage()!
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["fr-FR"]
    req.usesLanguageCorrection = true
    try? VNImageRequestHandler(cgImage: cg).perform([req])
    var lines: [[String: Any]] = []
    for obs in req.results ?? [] {
        guard let c = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox
        lines.append(["text": c.string, "conf": c.confidence,
                      "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height])
    }
    let data = try! JSONSerialization.data(withJSONObject: lines, options: [.prettyPrinted])
    try! data.write(to: out)
    print(url.lastPathComponent, lines.count)
}
