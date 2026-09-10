import AppKit

// App Store icons must not carry an alpha channel, even when every pixel is opaque.
for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    guard let source = NSBitmapImageRep(data: try Data(contentsOf: url)),
          let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil,
              pixelsWide: source.pixelsWide, pixelsHigh: source.pixelsHigh,
              bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false,
              isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
        fatalError("Cannot read icon: \(path)")
    }
    for y in 0..<source.pixelsHigh {
        for x in 0..<source.pixelsWide {
            guard let color = source.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else {
                fatalError("Cannot decode icon pixel")
            }
            let alpha = color.alphaComponent
            bitmap.setColor(NSColor(deviceRed: color.redComponent * alpha,
                green: color.greenComponent * alpha, blue: color.blueComponent * alpha,
                alpha: 1), atX: x, y: y)
        }
    }
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Cannot encode icon: \(path)")
    }
    try png.write(to: url)
}
