import { loadConfig, saveConfig } from "../config/config.js";
import { deriveRewriteAppState, deriveTrayMenuModel, withEnabled } from "./app-state.js";
import {
  appendMetadataLogEvent,
  statusClassForHttpStatus,
  type MetadataCategory,
  type MetadataLogEvent,
  type MetadataOutcome,
  type ProviderStatusClass
} from "./metadata-log.js";
import { planReplacementFlowRewrite } from "./replacement-flow.js";
import { runSafeTestRewrite } from "./test-rewrite.js";
import {
  type SettingsCommandResponse,
  settingsClearApiKeyResponse,
  settingsSaveResponse,
  settingsStatusResponse
} from "../settings/settings.js";
import type {
  ScreenshotContextDegradationCategory,
  ScreenshotContextInput,
  ScreenshotContextMediaType,
  ScreenshotPayloadSizeClass
} from "../screenshot/screenshot-context.js";

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
    case "settings-status":
      printJson(settingsStatusResponse());
      return;
    case "settings-save":
      printJson(await settingsSaveCommandResponse());
      return;
    case "settings-clear-api-key":
      printJson(settingsClearApiKeyCommandResponse());
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
    case "replacement-flow-started":
      printJson(replacementFlowStartedResponse());
      return;
    case "replacement-flow-rewrite":
      printJson(await replacementFlowRewriteResponse());
      return;
    case "replacement-flow-finished":
      printJson(replacementFlowFinishedResponse(parseJsonArgument(process.argv[3])));
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
  appendMetadataLogEvent({ event: "settings_opened" });

  return {
    ok: true,
    kind: "open_settings",
    notificationTitle: "Settings opened",
    notificationBody: "Review local settings before enabling Rewrite Hotkey."
  };
}

async function settingsSaveCommandResponse(): Promise<SettingsCommandResponse> {
  const response = settingsSaveResponse(JSON.parse(await readStdin()));

  if (response.ok) {
    appendMetadataLogEvent({
      event: "state_changed",
      configured: response.state.configured,
      enabled: response.state.enabled,
      hotkeyRegistrationAllowed: response.state.hotkeyRegistrationAllowed
    });
  }

  return response;
}

function settingsClearApiKeyCommandResponse(): SettingsCommandResponse {
  const response = settingsClearApiKeyResponse();
  appendMetadataLogEvent({
    event: "state_changed",
    configured: response.state.configured,
    enabled: response.state.enabled,
    hotkeyRegistrationAllowed: response.state.hotkeyRegistrationAllowed
  });

  return response;
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

function replacementFlowStartedResponse(): Record<string, unknown> {
  const state = deriveRewriteAppState(loadConfig());
  appendMetadataLogEvent({
    event: "replacement_flow_started",
    configured: state.configured,
    enabled: state.enabled,
    hotkeyRegistrationAllowed: state.hotkeyRegistrationAllowed
  });

  return {
    ok: true,
    kind: "replacement_flow_started",
    silent: true
  };
}

async function replacementFlowRewriteResponse(): Promise<unknown> {
  if (process.env.REWRITE_HOTKEY_PRIVATE_PIPE !== "1") {
    return {
      ok: false,
      action: "restore",
      code: "replacement_flow_safe_failure",
      category: "unexpected_error",
      metadata: {},
      notificationTitle: "Rewrite failed safely",
      notificationBody: "The private rewrite pipe was unavailable, so no paste work was started."
    };
  }

  const input = await readPrivateRewriteInput();

  return planReplacementFlowRewrite({
    config: loadConfig(),
    selectedText: input.selectedText,
    screenshotContext: input.screenshotContext
  });
}

function replacementFlowFinishedResponse(payload: unknown): Record<string, unknown> {
  const event = replacementFlowFinishedEvent(payload);
  appendMetadataLogEvent(event);

  if (event.outcome === "succeeded" && event.screenshotContextDegraded !== true) {
    return {
      ok: true,
      kind: "replacement_flow_finished",
      silent: true
    };
  }

  const notification = replacementFlowNotification(event);

  return {
    ok: event.outcome === "noop" || event.outcome === "succeeded",
    kind: "replacement_flow_finished",
    notificationTitle: notification.title,
    notificationBody: notification.body,
    category: event.category,
    providerStatusClass: event.providerStatusClass
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

interface PrivateRewriteInput {
  selectedText: string;
  screenshotContext?: ScreenshotContextInput;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readPrivateRewriteInput(): Promise<PrivateRewriteInput> {
  const stdin = await readStdin();

  if (process.env.REWRITE_HOTKEY_PRIVATE_PIPE_FORMAT !== "json") {
    return { selectedText: stdin };
  }

  const object = asRecord(JSON.parse(stdin));
  const selectedText = typeof object.selectedText === "string" ? object.selectedText : "";

  return {
    selectedText,
    screenshotContext: screenshotContextInputFrom(object.screenshotContext)
  };
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
    pasteSent: asBoolean(metadata.pasteSent),
    clipboardRestored: asBoolean(metadata.clipboardRestored),
    selectedTextCharLength: asNumber(metadata.selectedTextCharLength),
    usableTextCharLength: asNumber(metadata.usableTextCharLength),
    leadingWrapperLength: asNumber(metadata.leadingWrapperLength),
    trailingWrapperLength: asNumber(metadata.trailingWrapperLength),
    replacementTextCharLength: asNumber(metadata.replacementTextCharLength),
    pasteTextCharLength: asNumber(metadata.pasteTextCharLength),
    pollAttempts: asNumber(metadata.pollAttempts),
    screenshotContextEnabled: asBoolean(metadata.screenshotContextEnabled),
    screenshotContextCaptured: asBoolean(metadata.screenshotContextCaptured),
    screenshotContextIncluded: asBoolean(metadata.screenshotContextIncluded),
    screenshotContextDegraded: asBoolean(metadata.screenshotContextDegraded),
    screenshotContextDegradationCategory: screenshotContextDegradationCategoryFrom(
      metadata.screenshotContextDegradationCategory
    ),
    screenshotPayloadSizeClass: screenshotPayloadSizeClassFrom(metadata.screenshotPayloadSizeClass),
    durationMs: asNumber(metadata.durationMs)
  };
}

function replacementFlowFinishedEvent(payload: unknown): MetadataLogEvent {
  const object = asRecord(payload);
  const metadata = asRecord(object.metadata);
  const outcome = replacementFlowOutcomeFrom(object.outcome, object.ok);
  const category = metadataCategoryFrom(object.category);

  return {
    event: "replacement_flow_finished",
    outcome,
    category: outcome === "safe_failure" ? category : undefined,
    providerStatusClass: providerStatusClassFrom(object.providerStatusClass),
    targetCaptured: asBoolean(metadata.targetCaptured),
    clipboardSnapshotCaptured: asBoolean(metadata.clipboardSnapshotCaptured),
    copySent: asBoolean(metadata.copySent),
    pasteSent: asBoolean(metadata.pasteSent),
    clipboardRestored: asBoolean(metadata.clipboardRestored),
    selectedTextCharLength: asNumber(metadata.selectedTextCharLength),
    usableTextCharLength: asNumber(metadata.usableTextCharLength),
    leadingWrapperLength: asNumber(metadata.leadingWrapperLength),
    trailingWrapperLength: asNumber(metadata.trailingWrapperLength),
    replacementTextCharLength: asNumber(metadata.replacementTextCharLength),
    pasteTextCharLength: asNumber(metadata.pasteTextCharLength),
    pollAttempts: asNumber(metadata.pollAttempts),
    screenshotContextEnabled: asBoolean(metadata.screenshotContextEnabled),
    screenshotContextCaptured: asBoolean(metadata.screenshotContextCaptured),
    screenshotContextIncluded: asBoolean(metadata.screenshotContextIncluded),
    screenshotContextDegraded: asBoolean(metadata.screenshotContextDegraded),
    screenshotContextDegradationCategory: screenshotContextDegradationCategoryFrom(
      metadata.screenshotContextDegradationCategory
    ),
    screenshotPayloadSizeClass: screenshotPayloadSizeClassFrom(metadata.screenshotPayloadSizeClass),
    durationMs: asNumber(metadata.durationMs)
  };
}

function replacementFlowOutcomeFrom(value: unknown, ok: unknown): MetadataOutcome {
  switch (value) {
    case "succeeded":
      return "succeeded";
    case "noop":
      return "noop";
    case "safe_failure":
      return "safe_failure";
    default:
      return ok === true ? "succeeded" : "safe_failure";
  }
}

function metadataCategoryFrom(value: unknown): MetadataCategory | undefined {
  switch (value) {
    case "config_invalid":
    case "selected_text_empty":
    case "selected_text_too_large":
    case "style_prompt_empty":
    case "style_prompt_too_large":
    case "payload_too_large":
    case "vision_unsupported":
    case "azure_timeout":
    case "azure_network_error":
    case "azure_http_error":
    case "azure_malformed_response":
    case "model_empty_output":
    case "model_explanatory_output":
    case "model_metadata_output":
    case "model_ambiguous_output":
    case "unexpected_error":
    case "disabled_app":
    case "configuration_required":
    case "rewrite_target_unavailable":
    case "rewrite_target_changed":
    case "clipboard_snapshot_failed":
    case "copy_failed":
    case "clipboard_restore_failed":
    case "clipboard_write_failed":
    case "paste_failed":
    case "hotkey_registration_conflict":
    case "hotkey_invalid":
      return value;
    default:
      return undefined;
  }
}

function providerStatusClassFrom(value: unknown): ProviderStatusClass | undefined {
  switch (value) {
    case "1xx":
    case "2xx":
    case "3xx":
    case "4xx":
    case "5xx":
      return value;
    default:
      return undefined;
  }
}

function screenshotContextInputFrom(value: unknown): ScreenshotContextInput | undefined {
  const object = asRecord(value);

  if (object.ok === false) {
    return {
      ok: false,
      category: screenshotContextDegradationCategoryFrom(object.category)
    };
  }

  if (
    object.ok === true &&
    isScreenshotContextMediaType(object.mediaType) &&
    typeof object.base64 === "string" &&
    typeof object.byteLength === "number"
  ) {
    return {
      ok: true,
      mediaType: object.mediaType,
      base64: object.base64,
      byteLength: object.byteLength,
      width: asNumber(object.width),
      height: asNumber(object.height)
    };
  }

  return undefined;
}

function isScreenshotContextMediaType(value: unknown): value is ScreenshotContextMediaType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function screenshotContextDegradationCategoryFrom(
  value: unknown
): ScreenshotContextDegradationCategory | undefined {
  switch (value) {
    case "screenshot_capture_failed":
    case "screenshot_processing_failed":
    case "screenshot_payload_too_large":
    case "vision_unsupported":
      return value;
    default:
      return undefined;
  }
}

function screenshotPayloadSizeClassFrom(value: unknown): ScreenshotPayloadSizeClass | undefined {
  switch (value) {
    case "none":
    case "small":
    case "medium":
    case "large":
    case "too_large":
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

function replacementFlowNotification(event: MetadataLogEvent): { title: string; body: string } {
  if (event.outcome === "succeeded" && event.screenshotContextDegraded === true) {
    return {
      title: "Rewrite degraded",
      body: "Screenshot Context was unavailable, so the rewrite used Selected Text only."
    };
  }

  if (event.outcome === "noop") {
    return {
      title: "No changes suggested",
      body: "No change was suggested, so the original selection was left untouched."
    };
  }

  switch (event.category) {
    case "disabled_app":
      return {
        title: "Rewrite Hotkey disabled",
        body: "The in-flight rewrite was cancelled. Original selection and clipboard were restored where possible."
      };
    case "selected_text_empty":
      return {
        title: "No Selected Text captured",
        body: "Select usable text before pressing Rewrite Hotkey."
      };
    case "rewrite_target_changed":
      return {
        title: "Rewrite target changed",
        body: "The foreground app changed before paste, so the rewrite was discarded and the clipboard was restored where possible."
      };
    case "clipboard_snapshot_failed":
      return {
        title: "Rewrite failed safely",
        body: "The clipboard could not be snapshotted, so copy was not sent."
      };
    case "clipboard_restore_failed":
      return {
        title: "Clipboard restore failed",
        body: "The Clipboard Snapshot could not be restored."
      };
    case "clipboard_write_failed":
      return {
        title: "Rewrite failed safely",
        body: "Replacement Text could not be placed on the clipboard. Original selection and clipboard were restored where possible."
      };
    case "paste_failed":
      return {
        title: "Rewrite failed safely",
        body: "Replacement Text could not be pasted. Original selection and clipboard were restored where possible."
      };
    case "config_invalid":
    case "style_prompt_empty":
    case "style_prompt_too_large":
      return {
        title: "Rewrite Hotkey settings issue",
        body: "Check Settings. Original selection and clipboard were restored where possible."
      };
    case "azure_timeout":
    case "azure_network_error":
    case "azure_http_error":
    case "azure_malformed_response":
    case "vision_unsupported":
      return {
        title: "Rewrite failed safely",
        body: "Azure did not return valid Replacement Text. Original selection and clipboard were restored where possible."
      };
    case "model_empty_output":
    case "model_explanatory_output":
    case "model_metadata_output":
    case "model_ambiguous_output":
      return {
        title: "Rewrite failed safely",
        body: "The model output was not valid Replacement Text. Original selection and clipboard were restored where possible."
      };
    default:
      return {
        title: "Rewrite failed safely",
        body: "The Replacement Flow stopped before paste. Original selection and clipboard were restored where possible."
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
