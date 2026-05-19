import type { RewriteAppState } from "../app/app-state.js";

export const DEFAULT_COPY_POLL_TIMEOUT_MS = 750;
export const DEFAULT_COPY_POLL_INTERVAL_MS = 50;

export interface RewriteTarget {
  id: string;
}

export interface ClipboardSnapshot {
  id: string;
  previousPlainText?: string | null;
}

export interface WhitespaceWrappers {
  leading: string;
  trailing: string;
}

export interface CapturedSelectedText {
  selectedText: string;
  usableText: string;
  wrappers: WhitespaceWrappers;
}

export type SelectedTextCaptureFailureCategory =
  | "disabled_app"
  | "configuration_required"
  | "rewrite_target_unavailable"
  | "clipboard_snapshot_failed"
  | "copy_failed"
  | "selected_text_empty"
  | "clipboard_restore_failed"
  | "unexpected_error";

export interface SelectedTextCaptureMetadata {
  targetCaptured: boolean;
  clipboardSnapshotCaptured: boolean;
  copySent: boolean;
  clipboardRestored: boolean;
  selectedTextCharLength?: number;
  usableTextCharLength?: number;
  leadingWrapperLength?: number;
  trailingWrapperLength?: number;
  pollAttempts?: number;
  durationMs?: number;
}

export interface SelectedTextCaptureSuccess {
  ok: true;
  code: "selected_text_captured";
  category?: undefined;
  target: RewriteTarget;
  selectedText: CapturedSelectedText;
  metadata: SelectedTextCaptureMetadata;
  notificationTitle: string;
  notificationBody: string;
}

export interface SelectedTextCaptureFailure {
  ok: false;
  code: "selected_text_capture_safe_failure" | "selected_text_capture_blocked";
  category: SelectedTextCaptureFailureCategory;
  metadata: SelectedTextCaptureMetadata;
  notificationTitle: string;
  notificationBody: string;
}

export type SelectedTextCaptureOutcome = SelectedTextCaptureSuccess | SelectedTextCaptureFailure;

export interface SelectedTextNativePrimitives {
  captureForegroundTarget(): Promise<RewriteTarget>;
  captureClipboardSnapshot(): Promise<ClipboardSnapshot>;
  sendCopy(): Promise<void>;
  readClipboardPlainText(): Promise<string | null>;
  restoreClipboardSnapshot(snapshot: ClipboardSnapshot): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface SelectedTextCaptureOptions {
  state: RewriteAppState;
  native: SelectedTextNativePrimitives;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface ContentFreeSelectedTextCaptureView {
  ok: boolean;
  code: SelectedTextCaptureOutcome["code"];
  category?: SelectedTextCaptureFailureCategory;
  metadata: SelectedTextCaptureMetadata;
  notificationTitle: string;
  notificationBody: string;
}

export async function runSelectedTextCapture(
  options: SelectedTextCaptureOptions
): Promise<SelectedTextCaptureOutcome> {
  const startedAt = options.native.now();
  const metadata: SelectedTextCaptureMetadata = {
    targetCaptured: false,
    clipboardSnapshotCaptured: false,
    copySent: false,
    clipboardRestored: false,
    pollAttempts: 0
  };

  if (!options.state.enabled) {
    return failure("selected_text_capture_blocked", "disabled_app", metadata, elapsed(options.native, startedAt));
  }

  if (!options.state.hotkeyRegistrationAllowed) {
    return failure("selected_text_capture_blocked", "configuration_required", metadata, elapsed(options.native, startedAt));
  }

  let target: RewriteTarget;
  try {
    target = await options.native.captureForegroundTarget();
    metadata.targetCaptured = true;
  } catch {
    return failure(
      "selected_text_capture_safe_failure",
      "rewrite_target_unavailable",
      metadata,
      elapsed(options.native, startedAt)
    );
  }

  let snapshot: ClipboardSnapshot;
  try {
    snapshot = await options.native.captureClipboardSnapshot();
    metadata.clipboardSnapshotCaptured = true;
  } catch {
    return failure(
      "selected_text_capture_safe_failure",
      "clipboard_snapshot_failed",
      metadata,
      elapsed(options.native, startedAt)
    );
  }

  let pendingFailure: SelectedTextCaptureFailure | undefined;
  let captured: CapturedSelectedText | undefined;

  try {
    await options.native.sendCopy();
    metadata.copySent = true;

    const polledText = await pollForPlainText(options, metadata);
    if (polledText === null) {
      pendingFailure = failure(
        "selected_text_capture_safe_failure",
        "selected_text_empty",
        metadata,
        elapsed(options.native, startedAt)
      );
    } else {
      const classified = classifySelectedText(polledText);
      if (classified === null) {
        pendingFailure = failure(
          "selected_text_capture_safe_failure",
          "selected_text_empty",
          metadata,
          elapsed(options.native, startedAt)
        );
      } else {
        captured = classified;
        metadata.selectedTextCharLength = classified.selectedText.length;
        metadata.usableTextCharLength = classified.usableText.length;
        metadata.leadingWrapperLength = classified.wrappers.leading.length;
        metadata.trailingWrapperLength = classified.wrappers.trailing.length;
      }
    }
  } catch {
    pendingFailure = failure(
      "selected_text_capture_safe_failure",
      "copy_failed",
      metadata,
      elapsed(options.native, startedAt)
    );
  }

  try {
    await options.native.restoreClipboardSnapshot(snapshot);
    metadata.clipboardRestored = true;
  } catch {
    return failure(
      "selected_text_capture_safe_failure",
      "clipboard_restore_failed",
      metadata,
      elapsed(options.native, startedAt)
    );
  }

  if (pendingFailure !== undefined) {
    pendingFailure.metadata = { ...metadata, durationMs: elapsed(options.native, startedAt) };
    return pendingFailure;
  }

  if (captured === undefined) {
    return failure(
      "selected_text_capture_safe_failure",
      "unexpected_error",
      metadata,
      elapsed(options.native, startedAt)
    );
  }

  return {
    ok: true,
    code: "selected_text_captured",
    target,
    selectedText: captured,
    metadata: {
      ...metadata,
      durationMs: elapsed(options.native, startedAt)
    },
    notificationTitle: "Selected Text captured",
    notificationBody: "Rewrite Hotkey captured usable text and restored the clipboard. Azure and paste are not enabled yet."
  };
}

export function classifySelectedText(plainText: string): CapturedSelectedText | null {
  if (plainText.trim().length === 0) {
    return null;
  }

  const leading = plainText.match(/^\s*/u)?.[0] ?? "";
  const trailing = plainText.match(/\s*$/u)?.[0] ?? "";
  const usableText = plainText.slice(leading.length, plainText.length - trailing.length);

  return {
    selectedText: plainText,
    usableText,
    wrappers: {
      leading,
      trailing
    }
  };
}

export function toContentFreeSelectedTextCaptureView(
  outcome: SelectedTextCaptureOutcome
): ContentFreeSelectedTextCaptureView {
  return outcome.ok
    ? {
        ok: true,
        code: outcome.code,
        metadata: outcome.metadata,
        notificationTitle: outcome.notificationTitle,
        notificationBody: outcome.notificationBody
      }
    : {
        ok: false,
        code: outcome.code,
        category: outcome.category,
        metadata: outcome.metadata,
        notificationTitle: outcome.notificationTitle,
        notificationBody: outcome.notificationBody
      };
}

async function pollForPlainText(
  options: SelectedTextCaptureOptions,
  metadata: SelectedTextCaptureMetadata
): Promise<string | null> {
  const timeoutMs = options.pollTimeoutMs ?? DEFAULT_COPY_POLL_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_COPY_POLL_INTERVAL_MS;
  const deadline = options.native.now() + timeoutMs;

  do {
    metadata.pollAttempts = (metadata.pollAttempts ?? 0) + 1;
    const text = await options.native.readClipboardPlainText();

    if (text !== null) {
      return text;
    }

    if (options.native.now() >= deadline) {
      return null;
    }

    await options.native.sleep(pollIntervalMs);
  } while (options.native.now() <= deadline);

  return null;
}

function failure(
  code: SelectedTextCaptureFailure["code"],
  category: SelectedTextCaptureFailureCategory,
  metadata: SelectedTextCaptureMetadata,
  durationMs: number
): SelectedTextCaptureFailure {
  const notification = notificationForFailure(category);

  return {
    ok: false,
    code,
    category,
    metadata: {
      ...metadata,
      durationMs
    },
    notificationTitle: notification.title,
    notificationBody: notification.body
  };
}

function notificationForFailure(category: SelectedTextCaptureFailureCategory): { title: string; body: string } {
  switch (category) {
    case "disabled_app":
      return {
        title: "Rewrite Hotkey disabled",
        body: "No clipboard, Azure, or paste work was started."
      };
    case "configuration_required":
      return {
        title: "Rewrite Hotkey unavailable",
        body: "Open Settings before using Rewrite Hotkey."
      };
    case "rewrite_target_unavailable":
      return {
        title: "Selected Text capture failed safely",
        body: "The foreground Rewrite Target could not be captured, so copy was not sent."
      };
    case "clipboard_snapshot_failed":
      return {
        title: "Selected Text capture failed safely",
        body: "The clipboard could not be snapshotted, so copy was not sent."
      };
    case "copy_failed":
      return {
        title: "Selected Text capture failed safely",
        body: "The copy command could not be sent. No Azure or paste work was started."
      };
    case "selected_text_empty":
      return {
        title: "No Selected Text captured",
        body: "Select usable text before pressing Rewrite Hotkey. No Azure or paste work was started."
      };
    case "clipboard_restore_failed":
      return {
        title: "Clipboard restore failed",
        body: "No Azure or paste work was started, but the clipboard could not be restored."
      };
    case "unexpected_error":
      return {
        title: "Selected Text capture failed safely",
        body: "The capture path stopped before Azure or paste work."
      };
  }
}

function elapsed(native: SelectedTextNativePrimitives, startedAt: number): number {
  return Math.max(0, native.now() - startedAt);
}
