import fs from "node:fs";
import path from "node:path";
import { getConfigDirectory } from "../config/paths.js";
import type { SafeFailureCategory } from "../rewrite/types.js";
import type { SelectedTextCaptureFailureCategory } from "../capture/selected-text-capture.js";

export type MetadataEventName =
  | "app_started"
  | "state_changed"
  | "settings_opened"
  | "test_rewrite_started"
  | "test_rewrite_finished"
  | "hotkey_registration_finished"
  | "selected_text_capture_started"
  | "selected_text_capture_finished";

export type MetadataOutcome =
  | "succeeded"
  | "noop"
  | "safe_failure"
  | "blocked"
  | "captured"
  | "registered"
  | "registration_failed"
  | "unregistered";
export type ProviderStatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
export type MetadataCategory =
  | SafeFailureCategory
  | SelectedTextCaptureFailureCategory
  | "disabled_app"
  | "hotkey_registration_conflict"
  | "hotkey_invalid";

export interface MetadataLogEvent {
  event: MetadataEventName;
  timestamp?: string;
  configured?: boolean;
  enabled?: boolean;
  hotkeyRegistrationAllowed?: boolean;
  outcome?: MetadataOutcome;
  category?: MetadataCategory;
  providerStatusClass?: ProviderStatusClass;
  durationMs?: number;
  targetCaptured?: boolean;
  clipboardSnapshotCaptured?: boolean;
  copySent?: boolean;
  clipboardRestored?: boolean;
  selectedTextCharLength?: number;
  usableTextCharLength?: number;
  leadingWrapperLength?: number;
  trailingWrapperLength?: number;
  pollAttempts?: number;
}

export type MetadataLogger = (event: MetadataLogEvent) => void;

export function appendMetadataLogEvent(event: MetadataLogEvent, logPath = getMetadataLogPath()): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(sanitiseMetadataLogEvent(event))}\n`, "utf8");
}

export function getMetadataLogPath(): string {
  return path.join(getConfigDirectory(), "logs", "metadata.jsonl");
}

export function statusClassForHttpStatus(httpStatus: number | undefined): ProviderStatusClass | undefined {
  if (httpStatus === undefined || httpStatus < 100 || httpStatus >= 600) {
    return undefined;
  }

  return `${Math.floor(httpStatus / 100)}xx` as ProviderStatusClass;
}

function sanitiseMetadataLogEvent(event: MetadataLogEvent): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    timestamp: event.timestamp ?? new Date().toISOString(),
    event: event.event
  };

  if (event.configured !== undefined) {
    entry.configured = event.configured;
  }

  if (event.enabled !== undefined) {
    entry.enabled = event.enabled;
  }

  if (event.hotkeyRegistrationAllowed !== undefined) {
    entry.hotkeyRegistrationAllowed = event.hotkeyRegistrationAllowed;
  }

  if (event.outcome !== undefined) {
    entry.outcome = event.outcome;
  }

  if (event.category !== undefined) {
    entry.category = event.category;
  }

  if (event.providerStatusClass !== undefined) {
    entry.providerStatusClass = event.providerStatusClass;
  }

  if (event.durationMs !== undefined) {
    entry.durationMs = event.durationMs;
  }

  if (event.targetCaptured !== undefined) {
    entry.targetCaptured = event.targetCaptured;
  }

  if (event.clipboardSnapshotCaptured !== undefined) {
    entry.clipboardSnapshotCaptured = event.clipboardSnapshotCaptured;
  }

  if (event.copySent !== undefined) {
    entry.copySent = event.copySent;
  }

  if (event.clipboardRestored !== undefined) {
    entry.clipboardRestored = event.clipboardRestored;
  }

  if (event.selectedTextCharLength !== undefined) {
    entry.selectedTextCharLength = event.selectedTextCharLength;
  }

  if (event.usableTextCharLength !== undefined) {
    entry.usableTextCharLength = event.usableTextCharLength;
  }

  if (event.leadingWrapperLength !== undefined) {
    entry.leadingWrapperLength = event.leadingWrapperLength;
  }

  if (event.trailingWrapperLength !== undefined) {
    entry.trailingWrapperLength = event.trailingWrapperLength;
  }

  if (event.pollAttempts !== undefined) {
    entry.pollAttempts = event.pollAttempts;
  }

  return entry;
}
