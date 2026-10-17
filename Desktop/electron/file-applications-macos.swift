import AppKit
import Foundation

// stdin/stdout is the sole bridge. No shell or automation permission is involved.
func run() throws {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 16384,
          let request = try JSONSerialization.jsonObject(with: input) as? [String: String],
          let action = request["action"] else { throw NSError(domain: "request", code: 1) }
    if action == "stop" {
        guard let path = request["path"], path.hasSuffix("/Desktop for Step Code.app"),
              let value = request["pid"], let pid = Int32(value) else { throw NSError(domain: "process", code: 1) }
        if let running = NSRunningApplication(processIdentifier: pid), running.bundleURL?.standardizedFileURL.path == URL(fileURLWithPath: path).standardizedFileURL.path {
            running.forceTerminate()
        }
        FileHandle.standardOutput.write(Data("{}".utf8))
    } else if action == "launch" {
        guard let path = request["path"], path.hasPrefix("/"), path.hasSuffix("/Desktop for Step Code.app") else { throw NSError(domain: "path", code: 1) }
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: config) { app, error in
            guard error == nil, let application = app else { exit(1) }
            if let data = try? JSONSerialization.data(withJSONObject: ["pid": application.processIdentifier]) { FileHandle.standardOutput.write(data) }
            exit(0)
        }
        RunLoop.main.run()
    } else if action == "list" {
        guard let path = request["path"], path.hasPrefix("/") else { throw NSError(domain: "path", code: 1) }
        let urls = NSWorkspace.shared.urlsForApplications(toOpen: URL(fileURLWithPath: path))
        let result = urls.prefix(24).compactMap { url -> [String: String]? in
            guard let bundle = Bundle(url: url), bundle.infoDictionary?["CFBundlePackageType"] as? String == "APPL" else { return nil }
            var item = ["id": url.path, "label": FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")]
            let icon = NSWorkspace.shared.icon(forFile: url.path)
            icon.size = NSSize(width: 24, height: 24)
            if let tiff = icon.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]), png.count < 8192 {
                item["icon"] = "data:image/png;base64," + png.base64EncodedString()
            }
            return item
        }
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
    } else if action == "open" {
        guard let path = request["path"], let application = request["id"],
              path.hasPrefix("/"), application.hasPrefix("/"), application.hasSuffix(".app"),
              let bundle = Bundle(path: application), bundle.infoDictionary?["CFBundlePackageType"] as? String == "APPL",
              bundle.executableURL != nil else { throw NSError(domain: "application", code: 1) }
        let config = NSWorkspace.OpenConfiguration()
        NSWorkspace.shared.open([URL(fileURLWithPath: path)], withApplicationAt: URL(fileURLWithPath: application), configuration: config) { _, error in
            if error != nil { exit(1) }
            FileHandle.standardOutput.write(Data("{}".utf8)); exit(0)
        }
        RunLoop.main.run()
    } else { throw NSError(domain: "action", code: 1) }
}
do { try run() } catch { exit(1) }
