// Regenerate with: swift ios/scripts/generate-icon.swift
import AppKit

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()
NSColor(srgbRed: 0.055, green: 0.075, blue: 0.10, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
let gold = NSColor(srgbRed: 0.88, green: 0.72, blue: 0.47, alpha: 1)
let line = NSBezierPath()
line.move(to: NSPoint(x: 512, y: 295))
line.curve(to: NSPoint(x: 235, y: 330), controlPoint1: NSPoint(x: 400, y: 365), controlPoint2: NSPoint(x: 300, y: 355))
line.line(to: NSPoint(x: 235, y: 720))
line.curve(to: NSPoint(x: 512, y: 660), controlPoint1: NSPoint(x: 345, y: 765), controlPoint2: NSPoint(x: 435, y: 725))
line.curve(to: NSPoint(x: 789, y: 720), controlPoint1: NSPoint(x: 589, y: 725), controlPoint2: NSPoint(x: 679, y: 765))
line.line(to: NSPoint(x: 789, y: 330))
line.curve(to: NSPoint(x: 512, y: 295), controlPoint1: NSPoint(x: 724, y: 355), controlPoint2: NSPoint(x: 624, y: 365))
line.close()
gold.setStroke(); line.lineWidth = 28; line.lineJoinStyle = .round; line.stroke()
let spine = NSBezierPath(); spine.move(to: NSPoint(x: 512, y: 302)); spine.line(to: NSPoint(x: 512, y: 650)); spine.lineWidth = 20; spine.lineCapStyle = .round; spine.stroke()
for offset in [0.0, 75.0, 150.0] {
    let pages = NSBezierPath()
    pages.move(to: NSPoint(x: 295, y: 610 - offset))
    pages.curve(to: NSPoint(x: 452, y: 575 - offset), controlPoint1: NSPoint(x: 345, y: 630 - offset), controlPoint2: NSPoint(x: 410, y: 610 - offset))
    pages.lineWidth = 14; pages.lineCapStyle = .round; pages.stroke()
}
let bookmark = NSBezierPath()
bookmark.move(to: NSPoint(x: 637, y: 720)); bookmark.line(to: NSPoint(x: 637, y: 500)); bookmark.line(to: NSPoint(x: 680, y: 530)); bookmark.line(to: NSPoint(x: 723, y: 500)); bookmark.line(to: NSPoint(x: 723, y: 720)); bookmark.close()
gold.setFill(); bookmark.fill()
image.unlockFocus()
let representation = NSBitmapImageRep(data: image.tiffRepresentation!)!
let png = representation.representation(using: .png, properties: [:])!
let destination = URL(fileURLWithPath: "ios/Bookseerr/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
try png.write(to: destination)
print("Generated \(destination.path)")
