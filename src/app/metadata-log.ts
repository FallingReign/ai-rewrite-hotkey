import fs from "node:fs";
import path from "node:path";
import { getConfigDirectory } from "../config/paths.js";
import type { SafeFailureCategory } from "../rewrite/types.js";

export type MetadataEventName =
  | "app_started"
  | "state_changed"
  | "settings_opened"
  | "test_rewrite_started"
  | "test_rewrite_finished";

export type MetadataOutcome = "succeeded" | "noop" | "safe_failure" | "blocked";
export type ProviderStatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
export type MetadataCategory = SafeFailureCategory | "disabled_app";

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

  return entry;
}
