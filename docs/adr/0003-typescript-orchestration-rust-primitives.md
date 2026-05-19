# TypeScript orchestration with Rust native primitives

The **Replacement Flow**, prompt assembly, Azure OpenAI calls, settings handling, and UI-facing state will live in TypeScript, while Rust/Tauri exposes Windows-native primitives through commands and plugins. This keeps prompt and API iteration fast without giving up native reliability for keyboard, clipboard, screenshot, tray, hotkey, and autostart behaviour.
