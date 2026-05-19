# Rewrite Hotkey Personal Prototype

Rewrite Hotkey is a Windows tray utility for rewriting explicit **Selected Text** in-place with Azure OpenAI. V0 is a Personal Prototype: select text in any app, press the configured hotkey, and the app safely attempts to replace the selection with clearer **Replacement Text**.

## Product context

- PRD: [GitHub issue #1](https://github.com/FallingReign/ai-rewrite-hotkey/issues/1)
- Glossary and domain language: [`CONTEXT.md`](../CONTEXT.md)
- Architecture decisions: [`docs/adr`](./adr)

## Prerequisites

- Windows.
- Node.js and npm.
- Rust/Cargo for Tauri builds. The repo scripts use `scripts\with-cargo-path.mjs` so a Rustup install under `%USERPROFILE%\.cargo\bin` is found even if the current shell `PATH` is stale.
- An Azure OpenAI resource with a deployment that supports Chat Completions. Screenshot Context additionally requires a deployment/API path that accepts image input.

## Local configuration

Local settings are stored outside the repository:

```text
%APPDATA%\Rewrite Hotkey\config.json
```

Create the config file if it does not exist:

```powershell
npm run config:init
```

Open the tray settings UI from **Open Settings**, or open the raw JSON file:

```powershell
npm run config:open
```

Required Azure fields:

- `azureOpenAIEndpoint`
- `azureOpenAIApiKey`
- `azureOpenAIDeployment`
- `azureOpenAIApiVersion`

Other V0 settings:

- `enabled`
- `hotkey`
- `screenshotContextEnabled`
- `timeoutMs`
- `userStylePrompt`
- `launchOnStartup`

The settings UI leaves the API key input blank and only shows whether a stored key exists. Use **Clear API key** to remove the local key. **Locked Guardrails** are shown for reference but are not editable.

## Running the app

Start the tray app in development:

```powershell
npm run tauri:dev
```

Build installers:

```powershell
npm run tauri:build
```

Tray actions:

- **Enable Rewrite Hotkey** / **Disable Rewrite Hotkey**
- **Open Settings**
- **Test Rewrite**
- **Quit**

## Daily use

1. Select explicit text in any app.
2. Press the configured Rewrite Hotkey, default `Ctrl+Alt+Space`.
3. Leave focus in the same app while the rewrite runs.
4. If successful, the selected text is replaced silently.
5. If the rewrite fails, the original selection remains untouched where possible and a content-free notification explains the outcome.

## Test Rewrite

Run a live Azure request with only the built-in sample:

```powershell
npm run rewrite:test
```

The command prints only content-free status. It does not print local config, secrets, Selected Text, Replacement Text, screenshots, or provider payloads.

## Screenshot Context

When `screenshotContextEnabled` is true, the app captures an in-memory full-screen JPEG context image, compresses it, and sends it with the selected text only if the configured Azure API path appears vision-capable. Screenshot failures, oversized payloads, or unsupported vision input degrade to Selected Text only.

V0 screenshot limitations:

- Full-screen capture only.
- No redaction.
- No per-app allowlist or denylist.
- Screenshot data is sent to Azure when included.

## Privacy and logs

V0 sends the selected text, the editable Style Prompt, Locked Guardrails, and optional Screenshot Context to the configured Azure OpenAI deployment. The API key is stored in local JSON for V0 and should move to Windows Credential Manager later.

Metadata logs are stored per user:

```text
%APPDATA%\Rewrite Hotkey\logs\metadata.jsonl
```

Logs contain content-free metadata only: event names, outcomes, categories, provider status class, timings, booleans, and text lengths. They rotate to `metadata.jsonl.1` before the active log exceeds 256 KB.

## Development validation

Use the existing project checks:

```powershell
npm test
npm run typecheck
npm run tauri:check
npm run tauri:build
```

Do not commit `%APPDATA%\Rewrite Hotkey\config.json`, metadata logs, screenshots, API keys, endpoints copied from private environments, Selected Text, Replacement Text, or provider payloads.
