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

## Development checks

```powershell
npm test
npm run typecheck
```
