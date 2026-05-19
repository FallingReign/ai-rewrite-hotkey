# Rewrite Hotkey

Rewrite Hotkey is a Windows utility for rewriting explicit text selections in-place through a global hotkey.

## Language

**Selected Text**:
Text the user has explicitly highlighted in another app and that Rewrite Hotkey captures through the clipboard.
_Avoid_: Active field, whole field, terminal buffer, transcript

**Rewrite**:
A meaning-preserving transformation of **Selected Text** into direct **Replacement Text**.
_Avoid_: Suggestion, response, completion, generation

**Replacement Text**:
The exact text pasted over the user's **Selected Text** after a successful **Rewrite**.
_Avoid_: Assistant answer, alternative, explanation

**Replacement Flow**:
The end-to-end action where a hotkey turns **Selected Text** into pasted **Replacement Text** without further user confirmation.
_Avoid_: Copy-only mode, suggestion mode

**Safe Failure**:
A failed or uncertain rewrite attempt that leaves the user's original text and clipboard state intact where possible.
_Avoid_: Best-effort paste, silent failure

**Personal Prototype**:
A V0 build intended for one trusted Windows user to prove the rewrite loop before broader distribution.
_Avoid_: Internal beta, production app, team tool

**Screenshot Context**:
An optional screenshot sent with **Selected Text** to help the model understand where the rewrite will be used.
_Avoid_: OCR input, hidden text capture, screen scraping

**Rewrite Hotkey**:
The configured global keyboard shortcut that starts the **Replacement Flow**.
_Avoid_: Voice trigger, app command, manual script

**In-Flight Rewrite**:
A **Rewrite** that has started but has not yet succeeded, failed safely, or timed out.
_Avoid_: Job queue, concurrent rewrite

**Clipboard Snapshot**:
A restorable copy of the user's clipboard contents taken before Rewrite Hotkey changes the clipboard.
_Avoid_: Text-only backup, throwaway clipboard state

**Structured Text**:
Selected text such as code, commands, JSON, logs, URLs, or terminal output where syntax preservation matters more than stylistic improvement.
_Avoid_: Normal prose, freeform draft

**Style Prompt**:
The editable user preference text that guides how a **Rewrite** should sound.
_Avoid_: Guardrails, system rules

**Locked Guardrails**:
Non-editable instructions that protect meaning, fidelity, context use, and the **Replacement Text** output contract.
_Avoid_: Style prompt, user preference

**No-Op Rewrite**:
A rewrite attempt where the valid output is effectively identical to the original usable **Selected Text**, so nothing is pasted.
_Avoid_: Failed rewrite, replacement success

**Rewrite Timeout**:
The configurable limit for an **In-Flight Rewrite** before the app cancels and fails safely.
_Avoid_: Background completion, late paste

**Rewrite Target**:
The foreground window where the **Selected Text** was captured and where **Replacement Text** is expected to paste.
_Avoid_: Any focused app, last active app

**Rewrite Status**:
The subtle app-visible indication that a rewrite is currently in progress or has ended without replacement.
_Avoid_: Modal progress, blocking confirmation

**Configured App**:
A running app instance with enough valid settings to register the **Rewrite Hotkey** and call Azure OpenAI.
_Avoid_: First-run shell, partially configured app

**Disabled App**:
A running app instance whose **Rewrite Hotkey** is off and must not start clipboard, screenshot, or Azure work.
_Avoid_: Quit app, broken app

**Test Rewrite**:
A safe configuration check that rewrites a built-in sample without reading the clipboard, capturing the screen, or pasting into another app.
_Avoid_: Full replacement flow, clipboard test

**Private Rewrite Content**:
User text, replacement text, screenshots, secrets, and full provider payloads involved in a rewrite.
_Avoid_: Diagnostic metadata

**Rewrite Request**:
The outbound Azure OpenAI request containing **Selected Text**, **Locked Guardrails**, **Style Prompt**, and optional **Screenshot Context**.
_Avoid_: Provider-agnostic job, local rewrite

**Degraded Rewrite**:
A rewrite attempt that continues after losing optional context, with user notification, because the core selected-text replacement can still proceed safely.
_Avoid_: Silent fallback, safe failure

## Relationships

- **Selected Text** is the only V0 input to a rewrite.
- A **Rewrite** produces exactly one **Replacement Text**.
- **Replacement Text** replaces the original **Selected Text** in-place.
- V0 success means the **Replacement Flow** completed automatically.
- **Safe Failure** takes priority over completing the **Replacement Flow**.
- V0 is a **Personal Prototype**, not a distributable beta.
- **Screenshot Context** may support a **Rewrite**, but it is not a source of text to replace.
- In V0, **Screenshot Context** may be a full-screen screenshot.
- The **Rewrite Hotkey** starts the **Replacement Flow**.
- Only one **In-Flight Rewrite** may exist at a time.
- A **Clipboard Snapshot** must be captured before selected text capture mutates the clipboard.
- Failure to capture a **Clipboard Snapshot** causes **Safe Failure**.
- If no non-empty plain text is captured after the copy attempt, the result is **Safe Failure**.
- Captured **Selected Text** may match the previous clipboard text and still be valid.
- Whitespace-only captured text is not usable **Selected Text**.
- Leading and trailing whitespace around usable **Selected Text** should be preserved around **Replacement Text**.
- **Structured Text** may be selected, but a **Rewrite** must preserve its syntax unless only surrounding prose is improved.
- The **Style Prompt** guides tone, but **Locked Guardrails** take precedence.
- The default **Style Prompt** asks for clearer, shorter, more useful Australian English that preserves the user's uncertainty and avoids corporate fluff.
- V0 **Replacement Text** is plain text, not JSON or metadata.
- Empty or ambiguous model output is not valid **Replacement Text** and causes **Safe Failure**.
- A **No-Op Rewrite** does not paste and should notify the user that no change was suggested.
- The default **Rewrite Timeout** is 30 seconds and is configurable.
- When the **Rewrite Timeout** elapses, late results are discarded and never pasted automatically.
- If the foreground window changes away from the **Rewrite Target** before paste, the attempt becomes **Safe Failure**.
- An **In-Flight Rewrite** should show **Rewrite Status** without blocking the user's current app.
- Successful replacement is silent; no-selection, **Safe Failure**, timeout, configuration, and **No-Op Rewrite** outcomes should notify.
- The **Rewrite Hotkey** is enabled only when the app is a **Configured App**.
- A **Disabled App** stays available in the tray but does not start the **Replacement Flow**.
- **Test Rewrite** validates configuration without starting the **Replacement Flow**.
- Local logs may record metadata and errors, but not **Private Rewrite Content**.
- **Screenshot Context** is **Private Rewrite Content** and should not be written to disk.
- If **Screenshot Context** capture fails, V0 performs a **Degraded Rewrite** using **Selected Text** only and notifies the user.
- If configured Azure capabilities do not support vision input, V0 performs a **Degraded Rewrite** using **Selected Text** only and notifies the user.
- A **Rewrite Request** that exceeds configured text or image payload limits causes **Safe Failure**.
- V0 does not retry **Rewrite Request** failures automatically.
- V0 does not require paste confirmation before successful replacement.
- V0 does not infer whether paste succeeded through UI Automation.
- Terminal content is allowed only as explicitly selected **Structured Text**, not by terminal buffer parsing.

## Example dialogue

> **Dev:** "Should Rewrite Hotkey infer the whole active field if no text is highlighted?"
> **Domain expert:** "No — V0 only operates on **Selected Text**."
>
> **Dev:** "Can the model return a short explanation or a few alternative phrasings?"
> **Domain expert:** "No — a **Rewrite** returns only **Replacement Text**."
>
> **Dev:** "If a rewrite succeeds, should we copy the result and let the user paste manually?"
> **Domain expert:** "No — V0 success means the **Replacement Flow** pasted it automatically."
>
> **Dev:** "Should we paste if the result arrives after the timeout?"
> **Domain expert:** "No — that should become a **Safe Failure**."
>
> **Dev:** "Do we need enterprise-ready settings and secret storage before proving the loop?"
> **Domain expert:** "No — V0 is a **Personal Prototype** first."
>
> **Dev:** "Can the screenshot provide extra text to rewrite?"
> **Domain expert:** "No — **Screenshot Context** only helps interpret the **Selected Text**."
>
> **Dev:** "Does the user open a command palette to rewrite text?"
> **Domain expert:** "No — they select text and press the **Rewrite Hotkey**."
>
> **Dev:** "Can pressing the hotkey twice start two replacements?"
> **Domain expert:** "No — only one **In-Flight Rewrite** is allowed."
>
> **Dev:** "Can V0 just restore plain text after paste?"
> **Domain expert:** "No — a **Clipboard Snapshot** should preserve common clipboard formats where feasible."
>
> **Dev:** "Should the app refuse selected JSON or terminal output?"
> **Domain expert:** "No — **Structured Text** is allowed, but syntax preservation matters more than style."
>
> **Dev:** "Can the user style prompt ask for markdown explanations?"
> **Domain expert:** "No — **Locked Guardrails** require only **Replacement Text**."
>
> **Dev:** "Should we paste if the model returns the same text?"
> **Domain expert:** "No — that is a **No-Op Rewrite**."
>
> **Dev:** "Should a slow result paste after the timeout if it eventually arrives?"
> **Domain expert:** "No — the **Rewrite Timeout** makes late results stale."
>
> **Dev:** "Should we paste if the user switched apps during the rewrite?"
> **Domain expert:** "No — the original **Rewrite Target** is no longer active."
>
> **Dev:** "Should the app show a modal progress window?"
> **Domain expert:** "No — use subtle **Rewrite Status**."
>
> **Dev:** "Should every success show a toast?"
> **Domain expert:** "No — successful replacement should feel invisible."
>
> **Dev:** "Should the hotkey run before Azure settings are valid?"
> **Domain expert:** "No — the app must be a **Configured App** first."
>
> **Dev:** "If I disable the app from the tray, can it still inspect the clipboard?"
> **Domain expert:** "No — a **Disabled App** does no rewrite work."
>
> **Dev:** "Should Test rewrite paste into the current app?"
> **Domain expert:** "No — **Test Rewrite** never touches the user's current selection or clipboard."
>
> **Dev:** "Should logs include selected text for debugging?"
> **Domain expert:** "No — selected text is **Private Rewrite Content**."
>
> **Dev:** "Can screenshots be saved temporarily to debug failures?"
> **Domain expert:** "No — **Screenshot Context** stays in memory only."
>
> **Dev:** "If screenshot capture fails, should rewriting stop?"
> **Domain expert:** "No — continue as a **Degraded Rewrite** and notify."

## Flagged ambiguities

- "input" can mean several things; resolved for V0: the only input is **Selected Text**.
- "rewrite" can mean generic transformation or assistant advice; resolved: a **Rewrite** is direct, meaning-preserving replacement.
- "success" can mean generated text or pasted text; resolved for V0: success means automatic in-place replacement completed.
- "failure" can mean no result or no mutation; resolved: **Safe Failure** means avoiding destructive mutation.
- "V0" refers to a **Personal Prototype**, not a productized internal beta.
- "screenshot" does not mean OCR or another input source; resolved: **Screenshot Context** is interpretive context only.
- "screenshot scope" is resolved for V0: full-screen capture is acceptable for the **Personal Prototype**.
- "hotkey" means the global **Rewrite Hotkey**, not an app-local shortcut.
- "multiple rewrites" are not queued or parallelized in V0; a second hotkey press during an **In-Flight Rewrite** is ignored with notification.
- "clipboard restore" means restoring a **Clipboard Snapshot**, not merely putting prior plain text back.
- "no selection" is inferred from the copy attempt producing no usable plain text.
- "clipboard did not change" is not enough to infer no selection.
- "empty text" includes selections that contain only whitespace.
- "code" and "terminal snippets" are **Structured Text**, not separate V0 input sources.
- "prompt" can mean **Style Prompt** or **Locked Guardrails**; resolved: only **Style Prompt** is user-editable.
- "model output" for V0 means plain **Replacement Text** only.
- "cleanup" of model output is limited to obvious trimming; uncertain output is not pasted.
- "no change" is a **No-Op Rewrite**, not a failure.
- "timeout" means cancel and discard, not background completion.
- "target" means the foreground **Rewrite Target** captured at the start of the flow.
- "logs" are diagnostic metadata only, not **Private Rewrite Content**.
- "screenshot failure" is a **Degraded Rewrite** path, not a silent fallback.
- "disabled" means no rewrite-side effects, not merely hiding notifications.
- "terminal support" means selected text only, not terminal awareness.
