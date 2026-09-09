import Foundation
import Vision
import AppKit
import PDFKit

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let pages = CommandLine.arguments[2].split(separator: ",").compactMap { Int($0) }
let pdf = url.pathExtension.lowercased() == "pdf" ? PDFDocument(url: url) : nil
var output: [[String: Any]] = []
for number in pages {
    var image: CGImage?
    if let page = pdf?.page(at: number - 1) {
        let bounds = page.bounds(for: .mediaBox)
        let scale = min(2.0, 2400.0 / max(bounds.width, bounds.height))
        let size = NSSize(width: bounds.width * scale, height: bounds.height * scale)
        let thumbnail = page.thumbnail(of: size, for: .mediaBox)
        image = thumbnail.cgImage(forProposedRect: nil, context: nil, hints: nil)
    } else if pdf == nil, number == 1, let source = CGImageSourceCreateWithURL(url as CFURL, nil) {
        image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2400, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary)
    }
    guard let cg = image else { throw NSError(domain: "OCR", code: 1) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: cg).perform([request])
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    output.append(["number": number, "text": text])
}
let data = try JSONSerialization.data(withJSONObject: output)
FileHandle.standardOutput.write(data)
