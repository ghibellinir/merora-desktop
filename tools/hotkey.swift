// Globální klávesa ⌥M pro mikrofon Meri: funguje v jakékoli aplikaci, nejen v okně Merory.
// Když je okno otevřené, mikrofon přepne (zapnout / vypnout). Když není, otevře ho a mikrofon zapne.
// Běží na pozadí jako služba launchd app.merora.meri.hotkey (instaluje `npm run hotkey`), bez ikony v Docku.
// Jen kombinace kláves přes Carbon, takže nepotřebuje povolení Zpřístupnění ani Sledování vstupu.
import AppKit
import Carbon.HIToolbox

let port = ProcessInfo.processInfo.environment["MERI_PORT"] ?? "4747"
let baseUrl = "http://127.0.0.1:\(port)"

func logLine(_ text: String) {
  FileHandle.standardError.write("\(Date()) \(text)\n".data(using: .utf8)!)
}

// Je okno Merory otevřené (připojené k serveru)? Nil, když server neběží.
func windowIsOpen(_ done: @escaping (Bool?) -> Void) {
  var request = URLRequest(url: URL(string: "\(baseUrl)/api/status")!)
  request.timeoutInterval = 2
  URLSession.shared.dataTask(with: request) { data, _, error in
    guard let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      logLine("Stav Merory nejde zjistit: \(error?.localizedDescription ?? "neplatná odpověď")")
      done(nil)
      return
    }
    done(json["windowOpen"] as? Bool ?? false)
  }.resume()
}

// Příkaz pro server, potom: co udělat, až server odpoví.
func send(_ command: [String: Any], then: (() -> Void)? = nil) {
  var request = URLRequest(url: URL(string: "\(baseUrl)/cmd")!)
  request.httpMethod = "POST"
  request.httpBody = try? JSONSerialization.data(withJSONObject: command)
  request.timeoutInterval = 2
  URLSession.shared.dataTask(with: request) { _, _, error in
    if let error { logLine("Merora Desktop neodpovídá: \(error.localizedDescription)") }
    then?()
  }.resume()
}

// Nainstalovaná aplikace z Chromu (~/Applications/Chrome Apps), poznaná podle adresy serveru v Info.plist,
// ne podle jména (jmenuje se Merora, dřív Meri). Jinak okno v Chromu (bez Chromu ve výchozím prohlížeči,
// tam ale poslech nemusí fungovat).
func openWindow() {
  let chromeApps = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Chrome Apps.localized")
  let apps = ((try? FileManager.default.contentsOfDirectory(at: chromeApps, includingPropertiesForKeys: nil)) ?? [])
    .filter { $0.pathExtension == "app" }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }
  let ours = apps.first { app in
    let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
    return (info?["CrAppModeShortcutURL"] as? String)?.hasPrefix("\(baseUrl)/") == true
  }
  if let ours {
    NSWorkspace.shared.openApplication(at: ours, configuration: NSWorkspace.OpenConfiguration())
    return
  }
  let url = URL(string: "\(baseUrl)/app?app=1")!
  if let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome") {
    NSWorkspace.shared.open([url], withApplicationAt: chrome, configuration: NSWorkspace.OpenConfiguration())
  } else {
    NSWorkspace.shared.open(url)
  }
}

// Otevře okno a počká, až se připojí k serveru (nejvýš 20 s). Pak nachystá dnešní shrnutí a zapne
// mikrofon, v tomhle pořadí: jinak by rozhovor začal nad starým shrnutím.
func openAndEnableMic() {
  openWindow()
  func attempt(_ tries: Int) {
    windowIsOpen { isOpen in
      if isOpen == true {
        send(["cmd": "window"]) { send(["cmd": "mic", "enable": true]) }
      } else if tries < 40 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { attempt(tries + 1) }
      } else {
        logLine("Okno Merory se neotevřelo.")
      }
    }
  }
  attempt(0)
}

func pressed() {
  windowIsOpen { isOpen in
    if isOpen == true {
      send(["cmd": "mic"])
    } else {
      DispatchQueue.main.async { openAndEnableMic() }
    }
  }
}

// Aplikace musí existovat dřív, než se klávesa zaregistruje, jinak se události Carbonu nedoručí.
let app = NSApplication.shared
app.setActivationPolicy(.accessory) // bez ikony v Docku

var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
  logLine("⌥M stisknuto")
  pressed()
  return noErr
}, 1, &eventType, nil, nil)

var hotKeyRef: EventHotKeyRef?
let hotKeyId = EventHotKeyID(signature: OSType(0x4D45_5249), id: 1) // „MERI“
let status = RegisterEventHotKey(UInt32(kVK_ANSI_M), UInt32(optionKey), hotKeyId, GetApplicationEventTarget(), 0, &hotKeyRef)
guard status == noErr else {
  logLine("Klávesu ⌥M nejde zaregistrovat (chyba \(status)), nejspíš ji už používá jiná aplikace.")
  exit(1)
}
logLine("⌥M přepíná mikrofon Meri.")

app.run()
