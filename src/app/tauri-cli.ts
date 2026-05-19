import { spawn } from "node:child_process";
import { ensureConfigFile, loadConfig, saveConfig } from "../config/config.js";
import { deriveRewriteAppState, deriveTrayMenuModel, withEnabled } from "./app-state.js";
import { appendMetadataLogEvent, type MetadataCategory, type MetadataLogEvent } from "./metadata-log.js";
import { runSafeTestRewrite } from "./test-rewrite.js";

const command = process.argv[2] ?? "status";

main().catch(() => {
  printJson({
    ok: false,
    kind: "unexpected_error",
    notificationTitle: "Rewrite Hotkey action failed",
    notificationBody: "The requested action could not complete safely."
  });
  process.exitCode = 1;
});

async function main(): Promise<void> {
  switch (command) {
    case "status":
      printJson(statusResponse("status"));
      return;
    case "app-started":
      logAppStarted();
      printJson(statusResponse("app_started"));
      return;
    case "set-enabled":
      printJson(setEnabledResponse(parseEnabledArgument(process.argv[3])));
      return;
    case "open-settings":
      printJson(openSettingsResponse());
      return;
    case "test-rewrite":
      printJson({
        ok: true,
        kind: "test_rewrite",
        outcome: await runSafeTestRewrite({
          config: loadConfig(),
          logEvent: appendMetadataLogEvent
        })
      });
      return;
    case "hotkey-registration-finished":
      printJson(hotkeyRegistrationFinishedResponse(parseJsonArgument(process.argv[3])));
      return;
    case "selected-text-capture-started":
      printJson(selectedTextCaptureStartedResponse());
      return;
    case "selected-text-capture-finished":
      printJson(selectedTextCaptureFinishedResponse(parseJsonArgument(process.argv[3])));
      return;
    default:
      printJson({
        ok: false,
        kind: "unknown_command",
        notificationTitle: "Rewrite Hotkey action failed",
        notificationBody: "The requested action is not available."
      });
      process.exitCode = 1;
  }
}

function logAppStarted(): void {
  const state = deriveRewriteAppState(loadConfig());
  appendMetadataLogEvent({
    event: "app_started",
    configured: state.configured,
    enabled: state.enabled,
    hotkeyRegistrationAllowed: state.hotkeyRegistrationAllowed
  });
}

function statusResponse(kind: string): Record<string, unknown> {
  const state = deriveRewriteAppState(loadConfig());

  return {
    ok: true,
    kind,
    state,
    menu: deriveTrayMenuModel(state)
  };
}

function setEnabledResponse(enabled: boolean): Record<string, unknown> {
  const config = withEnabled(loadConfig(), enabled);
  saveConfig(config);

  const state = deriveRewriteAppState(config);
  appendMetadataLogEvent({
    event: "state_changed",
    configured: state.configured,
    enabled: state.enabled,
    hotkeyRegistrationAllowed: state.hotkeyRegistrationAllowed
  });

  return {
    ok: true,
    kind: "set_enabled",
    state,
    menu: deriveTrayMenuModel(state),
    notificationTitle: enabled ? "Rewrite Hotkey enabled" : "Rewrite Hotkey disabled",
    notificationBody: state.hotkeyRegistrationAllowed
      ? "The app is configured and ready."
      : "No rewrite hotkey or rewrite work will run until the app is enabled and configured."
  };
}

function openSettingsResponse(): Record<string, unknown> {
  const configPath = ensureConfigFile();

  if (process.platform === "win32") {
    const child = spawn("notepad.exe", [configPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  }

  appendMetadataLogEvent({ event: "settings_opened" });

  return {
    ok: true,
    kind: "open_settings",
    notificationTitle: "Settings opened",
    notificationBody: "Review local settings before enabling Rewrite Hotkey."
  };
}

function hotkeyRegistrationFinishedResponse(payload: unknown): Record<string, unknown> {
  const event = hotkeyRegistrationEvent(payload);
  appendMetadataLogEvent(event);

  if (event.outcome === "registered") {
    return {
      ok: true,
      kind: "hotkey_registration_finished",
      notificationTitle: "Rewrite Hotkey ready",
      notificationBody: "The configured hotkey is registered."
    };
  }

  return {
    ok: false,
    kind: "hotkey_registration_finished",
    notificationTitle: "Rewrite Hotkey conflict",
    notificationBody: "The configured hotkey could not be registered. The app will keep running."
  };
}

function selectedTextCaptureStartedResponse(): Record<string, unknown> {
  appendMetadataLogEvent({ event: "selected_text_capture_started" });

  return {
    ok: true,
    kind: "selected_text_capture_started"
  };
}

function selectedTextCaptureFinishedResponse(payload: unknown): Record<string, unknown> {
  const event = selectedTextCaptureEvent(payload);
  appendMetadataLogEvent(event);

  const notification = selectedTextCaptureNotification(event);

  return {
    ok: event.outcome === "captured",
    kind: "selected_text_capture_finished",
    notificationTitle: notification.title,
    notificationBody: notification.body
  };
}

function parseEnabledArgument(value: string | undefined): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error("invalid enabled argument");
}

function parseJsonArgument(value: string | undefined): unknown {
  if (value === undefined) {
    return {};
  }

  return JSON.parse(value);
}

function hotkeyRegistrationEvent(payload: unknown): MetadataLogEvent {
  const object = asRecord(payload);
  const ok = object.ok === true;
  const category = object.category === "hotkey_invalid" ? "hotkey_invalid" : "hotkey_registration_conflict";

  return {
    event: "hotkey_registration_finished",
    outcome: ok ? "registered" : "registration_failed",
    category: ok ? undefined : category
  };
}

function selectedTextCaptureEvent(payload: unknown): MetadataLogEvent {
  const object = asRecord(payload);
  const metadata = asRecord(object.metadata);
  const ok = object.ok === true;
  const category = metadataCategoryFrom(object.category);

  return {
    event: "selected_text_capture_finished",
    outcome: ok ? "captured" : "safe_failure",
    category: ok ? undefined : category,
    targetCaptured: asBoolean(metadata.targetCaptured),
    clipboardSnapshotCaptured: asBoolean(metadata.clipboardSnapshotCaptured),
    copySent: asBoolean(metadata.copySent),
    clipboardRestored: asBoolean(metadata.clipboardRestored),
    selectedTextCharLength: asNumber(metadata.selectedTextCharLength),
    usableTextCharLength: asNumber(metadata.usableTextCharLength),
    leadingWrapperLength: asNumber(metadata.leadingWrapperLength),
    trailingWrapperLength: asNumber(metadata.trailingWrapperLength),
    pollAttempts: asNumber(metadata.pollAttempts),
    durationMs: asNumber(metadata.durationMs)
  };
}

function metadataCategoryFrom(value: unknown): MetadataCategory | undefined {
  switch (value) {
    case "disabled_app":
    case "configuration_required":
    case "rewrite_target_unavailable":
    case "clipboard_snapshot_failed":
    case "copy_failed":
    case "selected_text_empty":
    case "clipboard_restore_failed":
    case "unexpected_error":
      return value;
    default:
      return undefined;
  }
}

function selectedTextCaptureNotification(event: MetadataLogEvent): { title: string; body: string } {
  if (event.outcome === "captured") {
    return {
      title: "Selected Text captured",
      body: "Rewrite Hotkey captured usable text and restored the clipboard. Azure and paste are not enabled yet."
    };
  }

  switch (event.category) {
    case "selected_text_empty":
      return {
        title: "No Selected Text captured",
        body: "Select usable text before pressing Rewrite Hotkey. No Azure or paste work was started."
      };
    case "clipboard_snapshot_failed":
      return {
        title: "Selected Text capture failed safely",
        body: "The clipboard could not be snapshotted, so copy was not sent."
      };
    case "clipboard_restore_failed":
      return {
        title: "Clipboard restore failed",
        body: "No Azure or paste work was started, but the clipboard could not be restored."
      };
    case "copy_failed":
      return {
        title: "Selected Text capture failed safely",
        body: "The copy command could not be sent. No Azure or paste work was started."
      };
    case "rewrite_target_unavailable":
      return {
        title: "Selected Text capture failed safely",
        body: "The foreground Rewrite Target could not be captured, so copy was not sent."
      };
    default:
      return {
        title: "Selected Text capture failed safely",
        body: "The capture path stopped before Azure or paste work."
      };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
