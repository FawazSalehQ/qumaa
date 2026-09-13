import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
guard arguments.count == 3 else { fatalError("usage: pdf-attachment input.pdf output.png") }
let source = URL(fileURLWithPath: arguments[1])
let target = URL(fileURLWithPath: arguments[2])
guard let document = CGPDFDocument(source as CFURL), let page = document.page(at: 1) else { fatalError("Cannot open PDF attachment") }
let box = page.getBoxRect(.mediaBox)
let scale: CGFloat = 3
let width = Int(ceil(box.width * scale))
let height = Int(ceil(box.height * scale))
guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("Cannot create context") }
context.clear(CGRect(x: 0, y: 0, width: width, height: height))
context.scaleBy(x: scale, y: scale)
context.translateBy(x: -box.minX, y: -box.minY)
context.drawPDFPage(page)
guard let result = context.makeImage(), let output = CGImageDestinationCreateWithURL(target as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("Cannot create PNG") }
CGImageDestinationAddImage(output, result, nil)
guard CGImageDestinationFinalize(output) else { fatalError("Cannot save PNG") }
