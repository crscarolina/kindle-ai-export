import CoreGraphics
import Foundation
import ImageIO
import Vision

// Reads image paths as arguments and prints the recognized text for each,
// separated by a NUL byte so callers can split multi-image output.
let args = Array(CommandLine.arguments.dropFirst())
let useLanguageCorrection = !args.contains("--no-language-correction")
let paths = args.filter { !$0.hasPrefix("--") }

func recognizeText(atPath path: String) -> String {
  let url = URL(fileURLWithPath: path)
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    FileHandle.standardError.write("unable to read image: \(path)\n".data(using: .utf8)!)
    exit(1)
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = useLanguageCorrection
  request.recognitionLanguages = ["en-US"]

  do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  } catch {
    FileHandle.standardError.write("OCR failed for \(path): \(error)\n".data(using: .utf8)!)
    exit(1)
  }

  return (request.results ?? [])
    .compactMap { $0.topCandidates(1).first?.string }
    .joined(separator: "\n")
}

print(paths.map(recognizeText).joined(separator: "\u{0}"))
