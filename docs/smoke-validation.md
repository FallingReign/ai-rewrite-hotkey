# V0 smoke validation

Date: 2026-05-19

Environment: Windows CLI session in a shared desktop context. Foreground GUI automation was treated as unavailable because driving global hotkeys, clipboard, and SendInput from this session could interfere with the active user. GUI target apps that were present are recorded below as environment-limited skips rather than failures.

## Commands run

| Check | Result |
| --- | --- |
| `npm run rewrite:test` | Passed. Live Azure Test Rewrite used only the built-in sample and printed content-free status. |
| Temporary-config settings CLI smoke | Passed. Save and Clear API key paths worked against a disposable `%APPDATA%` directory. |
| `npm test` | Passed: 72 tests. |
| `npm run typecheck` | Passed. |
| `npm run tauri:check` | Passed. |
| `npm run tauri:build` | Passed. MSI and NSIS bundles were produced under `src-tauri\target\release\bundle`. |

## Target app availability

| Target | Availability | Smoke result |
| --- | --- | --- |
| Notepad | `notepad.exe` present | Skipped: foreground GUI automation unavailable in the shared CLI session. |
| Browser text field | Edge, Chrome, and Firefox commands not found | Skipped: no browser command detected. |
| Slack | command not found | Skipped: app unavailable. |
| Teams | command not found | Skipped: app unavailable. |
| VS Code selected prose/comment | `Code.exe` command not found | Skipped: app unavailable. |
| Terminal selected text | `wt.exe` present | Skipped: foreground GUI automation unavailable in the shared CLI session. |

## Behaviour coverage

| Behaviour | Coverage |
| --- | --- |
| Successful replacement | Covered by automated Replacement Flow tests and Tauri build. GUI paste into Notepad/browser was skipped for environment safety. |
| Clipboard restoration | Covered by native-flow tests for no-op, safe failure, cancellation, target change, and metadata logging. |
| No-selection notification | Covered by Selected Text capture tests and Replacement Flow notification mapping. |
| Timeout cancellation | Covered by fake-timer test that aborts Azure work and prevents late paste. |
| Azure failure Safe Failure | Covered by Rewrite Request, Test Rewrite, and Replacement Flow tests with content-free provider status classes. |
| Screenshot Context Degraded Rewrite | Covered by screenshot capture failure, oversized payload, unsupported vision, and degraded-success tests. |
| Disabled App behaviour | Covered by app-state, Test Rewrite, Selected Text capture, and Replacement Flow no-side-effect tests. |
| Hotkey conflict handling | Covered by native registration path compile check and content-free notification mapping for registration conflicts. Live conflict reproduction was not attempted in the shared desktop session. |
| Test Rewrite safety | Covered by `npm run rewrite:test` live smoke and automated tests asserting built-in sample use and content-free output/logs. |

## Secrets and local files

No local config file, metadata log, screenshot, API key, Selected Text, Replacement Text, or provider payload was added to the repository. Local Azure config remains under `%APPDATA%\Rewrite Hotkey`.
