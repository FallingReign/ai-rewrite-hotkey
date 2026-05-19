# Rewrite Hotkey

Rewrite Hotkey is a Windows utility for rewriting explicit **Selected Text** in-place through a global **Rewrite Hotkey**.

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

The API key is stored only in the per-user local config file for V0. Do not copy local config values into the repository, issues, logs, or chat.

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

## Selected Text capture

When the configured Rewrite Hotkey fires, the app captures the foreground Rewrite Target, snapshots the native clipboard before copy, sends copy, polls briefly for usable plain Selected Text, restores the Clipboard Snapshot, and then stops. Azure replacement and paste are intentionally not connected yet. No-selection and whitespace-only selections notify with content-free Safe Failure messages.

## Development checks

```powershell
npm test
npm run typecheck
npm run tauri:check
```
