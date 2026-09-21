import CoreGraphics
import Foundation
import ImageIO
import Vision

// Reads image paths as arguments and prints the recognized text for each,
// separated by a NUL byte so callers can split multi-image output.
let args = Array(CommandLine.arguments.dropFirst())
let useLanguageCorrection = !args.contains("--no-language-correction")
let paths = args.filter { !$0.hasPrefix("--") }

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(message.data(using: .utf8)!)
  exit(1)
}

func recognize(
  _ image: CGImage,
  level: VNRequestTextRecognitionLevel,
  languageCorrection: Bool
) -> [VNRecognizedTextObservation] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = level
  request.usesLanguageCorrection = languageCorrection
  request.recognitionLanguages = ["en-US"]

  do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  } catch {
    fail("OCR failed: \(error)\n")
  }

  return request.results ?? []
}

/// Renders a cropped glyph on a white background, scaled and padded so Vision
/// will treat it as ordinary text rather than decoration.
func renderGlyph(_ glyph: CGImage, targetHeight: Int = 128) -> CGImage? {
  let scale = Double(targetHeight) / Double(glyph.height)
  let width = Int(Double(glyph.width) * scale)
  let padding = Int(Double(max(width, targetHeight)) * 0.6)
  let size = CGSize(width: width + padding * 2, height: targetHeight + padding * 2)

  guard
    let context = CGContext(
      data: nil,
      width: Int(size.width),
      height: Int(size.height),
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceGray(),
      bitmapInfo: CGImageAlphaInfo.none.rawValue
    )
  else {
    return nil
  }

  context.setFillColor(CGColor(gray: 1, alpha: 1))
  context.fill(CGRect(origin: .zero, size: size))
  context.interpolationQuality = .high
  context.draw(
    glyph,
    in: CGRect(x: padding, y: padding, width: width, height: targetHeight)
  )

  return context.makeImage()
}

/**
 Chapters open with a decorative drop cap. Vision's accurate model sometimes
 drops it entirely (leaving `Jur story` for `Our story`, or `wondered` for
 `I wondered`), though it always leaves the first line indented to make room.

 When that happens, crop the space to the left of the indented line and read
 the glyph with the fast model, which does recognize isolated capitals.
 Returns the letter so it can be emitted as its own line, matching what Vision
 produces when it reads the drop cap itself.
 */
func recoverDropCap(
  in image: CGImage,
  observations: [VNRecognizedTextObservation]
) -> (letter: String, beforeIndex: Int)? {
  let bodyLines = observations.enumerated().filter { $0.element.boundingBox.width > 0.5 }
  guard bodyLines.count > 1 else { return nil }

  let heights = bodyLines.map { $0.element.boundingBox.height }.sorted()
  let medianHeight = heights[heights.count / 2]

  // A drop cap Vision already read is tall and narrow; nothing to recover then
  let hasDropCapObservation = observations.contains {
    $0.boundingBox.height > medianHeight * 1.6 && $0.boundingBox.width < 0.2
  }
  if hasDropCapObservation { return nil }

  // The indented first line is what a missing drop cap leaves behind
  guard let indented = bodyLines.first(where: { $0.element.boundingBox.minX > 0.04 })
  else { return nil }

  let box = indented.element.boundingBox
  let width = Double(image.width), height = Double(image.height)
  let top = 1.0 - min(1.0, box.maxY + 0.12)
  let region = CGRect(
    x: 0,
    y: top * height,
    width: (box.minX + 0.012) * width,
    height: (min(1.0, box.maxY + 0.12) - box.minY) * height
  )

  // Inset to drop the rule drawn around the drop cap
  let inset = region.insetBy(dx: region.width * 0.12, dy: region.height * 0.12)
  guard
    inset.width > 1, inset.height > 1,
    let glyph = image.cropping(to: inset),
    let rendered = renderGlyph(glyph)
  else {
    return nil
  }

  let text = recognize(rendered, level: .fast, languageCorrection: false)
    .compactMap { $0.topCandidates(1).first?.string }
    .joined()
    .filter { $0.isLetter }
    .uppercased()

  // Only trust an unambiguous single letter
  guard text.count == 1 else { return nil }

  return (text, indented.offset)
}

func recognizeText(atPath path: String) -> String {
  let url = URL(fileURLWithPath: path)
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    fail("unable to read image: \(path)\n")
  }

  let observations = recognize(
    image,
    level: .accurate,
    languageCorrection: useLanguageCorrection
  )
  var lines = observations.compactMap { $0.topCandidates(1).first?.string }

  if let dropCap = recoverDropCap(in: image, observations: observations),
    dropCap.beforeIndex <= lines.count
  {
    lines.insert(dropCap.letter, at: dropCap.beforeIndex)
  }

  return lines.joined(separator: "\n")
}

print(paths.map(recognizeText).joined(separator: "\u{0}"))
