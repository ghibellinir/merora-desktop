# Globální Alt+M pro mikrofon Meri na Windows (na Macu to samé dělá tools/hotkey.swift s ⌥M).
# S otevřeným oknem Meri mikrofon přepne, bez něj Meri otevře a mikrofon zapne.
# Spouští se po přihlášení ze složky Po spuštění (npm run hotkey), bez okna. Log: %USERPROFILE%\.meri\hotkey.log
# Jen registrace klávesy přes RegisterHotKey, žádné sledování ostatních kláves a žádná práva správce.
$ErrorActionPreference = 'Stop'
$port = if ($env:MERI_PORT) { $env:MERI_PORT } else { '4747' }
$base = "http://127.0.0.1:$port"
$log = Join-Path $env:USERPROFILE '.meri\hotkey.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
function Write-Log($text) { Add-Content -Path $log -Value "$(Get-Date -Format s) $text" -Encoding UTF8 }

Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class MeriHotkey : NativeWindow {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);
  const int WM_HOTKEY = 0x0312;
  public Action Pressed;
  public bool Registered;
  public MeriHotkey() {
    CreateHandle(new CreateParams());
    // MOD_ALT (0x1) + MOD_NOREPEAT (0x4000), klávesa M (0x4D).
    Registered = RegisterHotKey(Handle, 1, 0x4001, 0x4D);
  }
  protected override void WndProc(ref Message m) {
    if (m.Msg == WM_HOTKEY && Pressed != null) Pressed();
    base.WndProc(ref m);
  }
}
'@

# Je okno Meri otevřené (připojené k serveru)?
function Test-WindowOpen {
  try { return [bool](Invoke-RestMethod -Uri "$base/api/status" -TimeoutSec 2).windowOpen } catch { return $false }
}
function Send-Command($body) {
  Invoke-RestMethod -Method Post -Uri "$base/cmd" -Body $body -TimeoutSec 2 | Out-Null
}
# Nainstalovaná aplikace z Chromu (nabídka Start, jmenuje se Merora, dřív Meri), jinak okno v Chromu
# (bez Chromu ve výchozím prohlížeči, tam ale poslech nemusí fungovat).
function Open-Window {
  $shortcut = Get-ChildItem -Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') -Recurse -Include 'Merora.lnk', 'Merora DEV.lnk', 'Meri.lnk' -ErrorAction SilentlyContinue |
    Sort-Object { if ($_.Name -eq 'Meri.lnk') { 1 } else { 0 } } | Select-Object -First 1
  if ($shortcut) { Start-Process $shortcut.FullName; return }
  try { Start-Process chrome "$base/app?app=1" } catch { Start-Process "$base/app?app=1" }
}

$hotkey = New-Object MeriHotkey
if (-not $hotkey.Registered) {
  Write-Log 'Klávesu Alt+M nejde zaregistrovat, nejspíš ji už používá jiná aplikace.'
  exit 1
}
$hotkey.Pressed = {
  try {
    if (Test-WindowOpen) {
      Send-Command '{"cmd":"mic"}'
    } else {
      Open-Window
      # Počká, až se okno připojí k serveru (nejvýš 20 s). Pak nachystá dnešní shrnutí a zapne mikrofon,
      # v tomhle pořadí: jinak by rozhovor začal nad starým shrnutím.
      for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-WindowOpen) {
          Send-Command '{"cmd":"window"}'
          Send-Command '{"cmd":"mic","enable":true}'
          break
        }
      }
    }
  } catch {
    Write-Log "Merora Desktop neodpovídá: $($_.Exception.Message)"
  }
}
Write-Log 'Alt+M přepíná mikrofon Meri.'
[System.Windows.Forms.Application]::Run()
