# Tauri v2 desktop shell

V0 will use Tauri v2 for the Windows desktop shell so the app can run from the system tray, register a global hotkey, support autostart, keep a small footprint, and use Rust for native escape hatches such as keyboard and clipboard behaviour. Electron and WinUI/.NET remain plausible alternatives, but Tauri best matches the prototype goal while AutoHotkey is unavailable in the target environment.
