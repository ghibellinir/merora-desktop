// Ikona aplikace (public/icon-512.png, icon-192.png): zaoblený čtverec s jednolitým tmavým pozadím a neuronem z loga
// Merory, menším a s měkkým okrajem (Riccardo 23. 11.: „ať Merora o malinko víc dýchá, jako Claude vedle“).
//   swiftc -O tools/icon.swift -o /tmp/icon && /tmp/icon <ikona s tvarem čtverce> "<logo 1024.png>" public/icon-512.png 0.66
//   sips -z 192 192 public/icon-512.png --out public/icon-192.png
// Argumenty: ikona s tvarem čtverce (průhlednost), logo 1024 × 1024 (neuron na tmavém, rámeček 64 px), výstup,
// kolik šířky čtverce má neuron zabírat (dřív 0,76).
import AppKit

let shapeRep = NSBitmapImageRep(data: NSImage(contentsOfFile: CommandLine.arguments[1])!.tiffRepresentation!)!
let logo = NSBitmapImageRep(data: NSImage(contentsOfFile: CommandLine.arguments[2])!.tiffRepresentation!)!.cgImage!
let out = CommandLine.arguments[3], share = CGFloat(Double(CommandLine.arguments[4])!)
let W = shapeRep.pixelsWide, H = shapeRep.pixelsHigh
func grayImage(_ w: Int, _ h: Int, _ f: (Int, Int) -> UInt8) -> CGImage {
  var buf = [UInt8](repeating: 0, count: w * h)
  for y in 0..<h { for x in 0..<w { buf[y * w + x] = f(x, y) } }
  return CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0), provider: CGDataProvider(data: Data(buf) as CFData)!, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
}
var minX = W, maxX = 0
let shape = grayImage(W, H) { x, y in
  let a = shapeRep.colorAt(x: x, y: y)?.alphaComponent ?? 0
  if a > 0.5 { minX = min(minX, x); maxX = max(maxX, x) }
  return UInt8(max(0, min(255, a * 255)))
}
let square = CGFloat(maxX - minX + 1)
let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let full = CGRect(x: 0, y: 0, width: W, height: H)
// Vnitřek loga bez rámečku (64..960), neuron v něm zabírá 86,5 % šířky.
let crop = logo.cropping(to: CGRect(x: 64, y: 64, width: 896, height: 896))!
let size = share * square / 0.865
let rect = CGRect(x: (CGFloat(W) - size) / 2, y: (CGFloat(H) - size) / 2, width: size, height: size)
let n = Int(size.rounded())
// Barva výplně = průměr okraje vloženého loga, změřený ve stejném barevném prostoru jako výsledek (jinak po
// převodu barev vznikne kolem neuronu jemný čtverec).
let probe = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4, space: ctx.colorSpace!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
probe.interpolationQuality = .high
probe.draw(crop, in: CGRect(x: 0, y: 0, width: n, height: n))
let px = probe.data!.bindMemory(to: UInt8.self, capacity: n * n * 4)
var sum = [0.0, 0.0, 0.0], count = 0.0
for y in 0..<n { for x in 0..<n {
  let dx = abs((Double(x) + 0.5) / Double(n) - 0.5), dy = abs((Double(y) + 0.5) / Double(n) - 0.5)
  let q = pow(pow(dx, 6) + pow(dy, 6), 1.0 / 6) / 0.5
  let i = (y * n + x) * 4
  guard q >= 0.93, q <= 1.0, Int(px[i]) + Int(px[i + 1]) + Int(px[i + 2]) < 100 else { continue }
  for k in 0..<3 { sum[k] += Double(px[i + k]) }
  count += 1
} }
let fill = sum.map { CGFloat($0 / max(count, 1) / 255) }
ctx.clip(to: full, mask: shape)
ctx.setFillColor(CGColor(colorSpace: ctx.colorSpace!, components: [fill[0], fill[1], fill[2], 1])!)
ctx.fill(full)
// Měkký okraj ve tvaru zaobleného čtverce (p-norma 6): kulatý by zasáhl do konečků na diagonálách (pravý horní
// oranžový byl ztmavený, Riccardo 23. 11.). Konečky končí nejdál na 0,92, okraj se rozplývá od 0,93 do 1.
let fade = grayImage(n, n) { x, y in
  let dx = abs((CGFloat(x) + 0.5) / CGFloat(n) - 0.5), dy = abs((CGFloat(y) + 0.5) / CGFloat(n) - 0.5)
  let r = pow(pow(dx, 6) + pow(dy, 6), 1 / 6) / 0.5
  let t = max(0, min(1, (1.0 - r) / (1.0 - 0.93)))
  return UInt8(t * t * (3 - 2 * t) * 255)
}
ctx.saveGState()
ctx.clip(to: rect, mask: fade)
ctx.interpolationQuality = .high
ctx.draw(crop, in: rect)
ctx.restoreGState()
try! NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("ok \(out) čtverec \(square) neuron \(Int(share * square)) px")
