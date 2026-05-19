# Rewrite Hotkey

Rewrite Hotkey is a Windows utility for rewriting explicit **Selected Text** in-place through a global **Rewrite Hotkey**.

Product and prototype docs:

- [Personal Prototype setup and usage](docs/personal-prototype.md)
- [V0 smoke validation](docs/smoke-validation.md)
- [Product glossary](CONTEXT.md)
- [Architecture decisions](docs/adr)
- [PRD issue](https://github.com/FallingReign/ai-rewrite-hotkey/issues/1)

## Local configuration

The Personal Prototype stores local configuration outside this repository:

```text
%APPDATA%\Rewrite Hotkey\config.json
```

Create the file:

```powershell
npm run config:init
```

Show the path:

```powershell
npm run config:path
```

Open it in Notepad:

```powershell
npm run config:open
```

Check whether the app is a **Configured App**:

```powershell
npm run config:status
```

Fill in these values before live Azure testing:

- `azureOpenAIEndpoint`
- `azureOpenAIApiKey`
- `azureOpenAIDeployment`
- `azureOpenAIApiVersion`

`screenshotContextEnabled` defaults to `true` for the Personal Prototype. Screenshots are optional context for the Replacement Flow only; failures or unsupported vision input degrade to Selected Text only.

The API key is stored only in the per-user local config file for V0. Do not copy local config values into the repository, issues, logs, or chat.

The tray app also includes a minimal **Open Settings** window for editing the local config. The UI leaves the API key field blank, shows only whether a stored key exists, and includes a **Clear API key** action. Saved settings are validated before they replace the local config; changing the Rewrite Hotkey re-registers it, and `launchOnStartup` controls the current Windows user's startup registration.

Metadata logs are written under the same per-user app data directory at `logs\metadata.jsonl`. They keep only content-free categories, status classes, timings, and length metadata, and rotate to `metadata.jsonl.1` before the active log exceeds 256 KB.

## Live Test Rewrite

Run a text-only **Test Rewrite** against the configured Azure OpenAI resource:

```powershell
npm run rewrite:test
```

The command sends only a built-in sample, validates plain **Replacement Text**, classifies **Safe Failure** and **No-Op Rewrite** outcomes, and keeps output content-free. It does not print config values, API keys, endpoints, Selected Text, Replacement Text, or full provider payloads.

## Tauri tray shell

Run the tray-first desktop shell:

```powershell
npm run tauri:dev
```

The tray menu exposes enable, disable, open settings, Test Rewrite, and quit actions. The shell registers the configured global Rewrite Hotkey only when the app is enabled and configured. Registration conflicts notify without crashing the app. Test Rewrite uses the built-in sample and logs metadata only.

## Replacement Flow

When the configured Rewrite Hotkey fires, the app captures the foreground Rewrite Target, snapshots the native clipboard before copy, sends copy, polls briefly for usable plain Selected Text, optionally captures in-memory full-screen Screenshot Context, sends a live Azure Rewrite Request, validates plain Replacement Text, pastes it over the original selection, waits 500 ms, and restores the Clipboard Snapshot. Successful replacement is silent unless the rewrite degrades to Selected Text only because optional Screenshot Context was unavailable or unsupported. No-Op Rewrite and Safe Failure outcomes notify with content-free messages.

## Development checks

```powershell
npm test
npm run typecheck
npm run tauri:check
```
