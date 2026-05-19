import { spawn } from "node:child_process";
import { ensureConfigFile, loadConfig, saveConfig } from "../config/config.js";
import { deriveRewriteAppState, deriveTrayMenuModel, withEnabled } from "./app-state.js";
import { appendMetadataLogEvent } from "./metadata-log.js";
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

function parseEnabledArgument(value: string | undefined): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error("invalid enabled argument");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
