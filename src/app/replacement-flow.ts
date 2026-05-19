import {
  classifySelectedText,
  DEFAULT_COPY_POLL_INTERVAL_MS,
  DEFAULT_COPY_POLL_TIMEOUT_MS,
  type ClipboardSnapshot,
  type RewriteTarget
} from "../capture/selected-text-capture.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import type { ScreenshotContextInput, ScreenshotContextMetadata } from "../screenshot/screenshot-context.js";
import { runScreenshotAwareRewriteRequest } from "../rewrite/rewrite-request.js";
import type { FetchLike, RewriteTimer, SafeFailureCategory } from "../rewrite/types.js";
import { deriveRewriteAppState } from "./app-state.js";
import { statusClassForHttpStatus, type MetadataCategory, type ProviderStatusClass } from "./metadata-log.js";

export type ReplacementFlowRewriteCode =
  | "replacement_flow_ready_to_paste"
  | "replacement_flow_noop"
  | "replacement_flow_safe_failure"
  | "replacement_flow_blocked";

export type ReplacementFlowRewriteAction = "paste" | "noop" | "restore";

export interface ReplacementFlowRewriteMetadata {
  targetCaptured?: boolean;
  clipboardSnapshotCaptured?: boolean;
  copySent?: boolean;
  pasteSent?: boolean;
  clipboardRestored?: boolean;
  selectedTextCharLength?: number;
  usableTextCharLength?: number;
  leadingWrapperLength?: number;
  trailingWrapperLength?: number;
  replacementTextCharLength?: number;
  pasteTextCharLength?: number;
  pollAttempts?: number;
  durationMs?: number;
  screenshotContextEnabled?: boolean;
  screenshotContextCaptured?: boolean;
  screenshotContextIncluded?: boolean;
  screenshotContextDegraded?: boolean;
  screenshotContextDegradationCategory?: ScreenshotContextMetadata["screenshotContextDegradationCategory"];
  screenshotPayloadSizeClass?: ScreenshotContextMetadata["screenshotPayloadSizeClass"];
}

export interface ReplacementFlowRewriteOptions {
  config: RewriteHotkeyConfig;
  selectedText: string;
  fetchFn?: FetchLike;
  abortSignal?: AbortSignal;
  timer?: RewriteTimer;
  now?: () => number;
  screenshotContext?: ScreenshotContextInput;
}

export interface ReplacementFlowPastePlan {
  ok: true;
  action: "paste";
  code: "replacement_flow_ready_to_paste";
  pasteText: string;
  metadata: ReplacementFlowRewriteMetadata;
  notificationTitle?: string;
  notificationBody?: string;
}

export interface ReplacementFlowNoOpPlan {
  ok: true;
  action: "noop";
  code: "replacement_flow_noop";
  metadata: ReplacementFlowRewriteMetadata;
  notificationTitle: string;
  notificationBody: string;
}

export interface ReplacementFlowRestorePlan {
  ok: false;
  action: "restore";
  code: "replacement_flow_safe_failure" | "replacement_flow_blocked";
  category: MetadataCategory;
  providerStatusClass?: ProviderStatusClass;
  metadata: ReplacementFlowRewriteMetadata;
  notificationTitle: string;
  notificationBody: string;
}

export type ReplacementFlowRewritePlan = ReplacementFlowPastePlan | ReplacementFlowNoOpPlan | ReplacementFlowRestorePlan;
export type ContentFreeReplacementFlowRewritePlan = Omit<ReplacementFlowPastePlan, "pasteText"> | ReplacementFlowNoOpPlan | ReplacementFlowRestorePlan;

export async function planReplacementFlowRewrite(
  options: ReplacementFlowRewriteOptions
): Promise<ReplacementFlowRewritePlan> {
  const startedAt = now(options);
  const state = deriveRewriteAppState(options.config);

  if (!state.enabled) {
    return blocked("disabled_app", elapsed(options, startedAt));
  }

  const captured = classifySelectedText(options.selectedText);
  if (captured === null) {
    return safeFailure("selected_text_empty", {}, elapsed(options, startedAt));
  }

  const baseMetadata: ReplacementFlowRewriteMetadata = {
    selectedTextCharLength: captured.selectedText.length,
    usableTextCharLength: captured.usableText.length,
    leadingWrapperLength: captured.wrappers.leading.length,
    trailingWrapperLength: captured.wrappers.trailing.length
  };

  try {
    const rewrite = await runScreenshotAwareRewriteRequest({
      config: options.config,
      selectedText: captured.usableText,
      fetchFn: options.fetchFn,
      abortSignal: options.abortSignal,
      timer: options.timer,
      screenshotContext: options.screenshotContext
    });
    const result = rewrite.result;
    const rewriteMetadata = {
      ...baseMetadata,
      ...rewrite.metadata
    };

    const durationMs = elapsed(options, startedAt);

    switch (result.status) {
      case "replacement": {
        const pasteText = `${captured.wrappers.leading}${result.replacementText}${captured.wrappers.trailing}`;
        return {
          ok: true,
          action: "paste",
          code: "replacement_flow_ready_to_paste",
          pasteText,
          metadata: {
            ...rewriteMetadata,
            replacementTextCharLength: result.replacementText.length,
            pasteTextCharLength: pasteText.length,
            durationMs
          },
          ...optionalDegradedRewriteNotification(rewriteMetadata)
        };
      }
      case "noop":
        return {
          ok: true,
          action: "noop",
          code: "replacement_flow_noop",
          metadata: {
            ...rewriteMetadata,
            durationMs
          },
          ...requiredRewriteNotification(rewriteMetadata, {
            title: "No changes suggested",
            body: "No change was suggested, so the original selection was left untouched."
          })
        };
      case "safe_failure":
        return safeFailure(
          result.category,
          rewriteMetadata,
          durationMs,
          statusClassForHttpStatus(result.httpStatus)
        );
    }
  } catch {
    return safeFailure("unexpected_error", baseMetadata, elapsed(options, startedAt));
  }
}

export function toContentFreeReplacementFlowRewritePlan(
  plan: ReplacementFlowRewritePlan
): ContentFreeReplacementFlowRewritePlan {
  if (plan.action !== "paste") {
    return plan;
  }

  return {
    ok: plan.ok,
    action: plan.action,
    code: plan.code,
    metadata: plan.metadata
  };
}

export type ReplacementFlowRuntimeStatus = "idle" | "in_flight";
export type ReplacementFlowRunOutcome = "succeeded" | "noop" | "safe_failure" | "ignored";

export interface ReplacementFlowNativePrimitives {
  captureForegroundTarget(): Promise<RewriteTarget>;
  captureClipboardSnapshot(): Promise<ClipboardSnapshot>;
  captureScreenshotContext?(): Promise<ScreenshotContextInput>;
  sendCopy(): Promise<void>;
  readClipboardPlainText(): Promise<string | null>;
  writeClipboardPlainText(text: string): Promise<void>;
  sendPaste(): Promise<void>;
  restoreClipboardSnapshot(snapshot: ClipboardSnapshot): Promise<void>;
  isForegroundTarget(target: RewriteTarget): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface ReplacementFlowRunOptions {
  config: RewriteHotkeyConfig;
  native: ReplacementFlowNativePrimitives;
  fetchFn?: FetchLike;
  abortSignal?: AbortSignal;
  timer?: RewriteTimer;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface ReplacementFlowRunResult {
  ok: boolean;
  outcome: ReplacementFlowRunOutcome;
  category?: MetadataCategory;
  providerStatusClass?: ProviderStatusClass;
  metadata: ReplacementFlowRewriteMetadata;
  notificationTitle?: string;
  notificationBody?: string;
}

export interface ReplacementFlowControllerCallbacks {
  setStatus?(status: ReplacementFlowRuntimeStatus): void;
  notify?(title: string, body: string): void;
}

export class ReplacementFlowController {
  private inFlight: AbortController | undefined;

  constructor(private readonly callbacks: ReplacementFlowControllerCallbacks = {}) {}

  start(options: ReplacementFlowRunOptions): Promise<ReplacementFlowRunResult> {
    if (this.inFlight !== undefined) {
      const ignored = ignoredInFlightResult();
      this.callbacks.notify?.(ignored.notificationTitle ?? "", ignored.notificationBody ?? "");
      return Promise.resolve(ignored);
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    this.inFlight = controller;
    this.callbacks.setStatus?.("in_flight");

    if (options.abortSignal?.aborted) {
      controller.abort();
    } else {
      options.abortSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    return runReplacementFlow({
      ...options,
      abortSignal: controller.signal
    }).finally(() => {
      options.abortSignal?.removeEventListener("abort", abortFromCaller);
      if (this.inFlight === controller) {
        this.inFlight = undefined;
        this.callbacks.setStatus?.("idle");
      }
    });
  }

  cancelInFlight(): void {
    this.inFlight?.abort();
  }
}

export async function runReplacementFlow(options: ReplacementFlowRunOptions): Promise<ReplacementFlowRunResult> {
  const startedAt = options.native.now();
  const state = deriveRewriteAppState(options.config);
  const metadata: ReplacementFlowRewriteMetadata = {
    targetCaptured: false,
    clipboardSnapshotCaptured: false,
    copySent: false,
    pasteSent: false,
    clipboardRestored: false,
    pollAttempts: 0
  };

  if (!state.enabled) {
    return runFailure("disabled_app", metadata, elapsedNative(options.native, startedAt));
  }

  if (!state.hotkeyRegistrationAllowed) {
    return runFailure("configuration_required", metadata, elapsedNative(options.native, startedAt));
  }

  let target: RewriteTarget;
  try {
    target = await options.native.captureForegroundTarget();
    metadata.targetCaptured = true;
  } catch {
    return runFailure("rewrite_target_unavailable", metadata, elapsedNative(options.native, startedAt));
  }

  let snapshot: ClipboardSnapshot;
  try {
    snapshot = await options.native.captureClipboardSnapshot();
    metadata.clipboardSnapshotCaptured = true;
  } catch {
    return runFailure("clipboard_snapshot_failed", metadata, elapsedNative(options.native, startedAt));
  }

  try {
    await options.native.sendCopy();
    metadata.copySent = true;

    const selectedText = await pollForPlainText(options, metadata);
    if (selectedText === null) {
      return restoreThenRunFailure(options, snapshot, "selected_text_empty", metadata, startedAt);
    }

    const captured = classifySelectedText(selectedText);
    if (captured === null) {
      return restoreThenRunFailure(options, snapshot, "selected_text_empty", metadata, startedAt);
    }

    metadata.selectedTextCharLength = captured.selectedText.length;
    metadata.usableTextCharLength = captured.usableText.length;
    metadata.leadingWrapperLength = captured.wrappers.leading.length;
    metadata.trailingWrapperLength = captured.wrappers.trailing.length;

    if (options.abortSignal?.aborted) {
      return restoreThenRunFailure(options, snapshot, "disabled_app", metadata, startedAt);
    }

    const screenshotContext = await captureOptionalNativeScreenshotContext(options);
    const plan = await planReplacementFlowRewrite({
      config: options.config,
      selectedText,
      fetchFn: options.fetchFn,
      abortSignal: options.abortSignal,
      timer: options.timer,
      now: () => options.native.now(),
      screenshotContext
    });

    mergePlanMetadata(metadata, plan.metadata);

    if (options.abortSignal?.aborted) {
      return restoreThenRunFailure(options, snapshot, "disabled_app", metadata, startedAt);
    }

    if (plan.action === "noop") {
      const restored = await restoreSnapshot(options.native, snapshot, metadata, startedAt);
      if (!restored.ok) {
        return restored;
      }

      return {
        ok: true,
        outcome: "noop",
        metadata: withDuration(metadata, options.native, startedAt),
        notificationTitle: plan.notificationTitle,
        notificationBody: plan.notificationBody
      };
    }

    if (plan.action === "restore") {
      return restoreThenRunFailure(
        options,
        snapshot,
        plan.category,
        metadata,
        startedAt,
        plan.providerStatusClass,
        plan.notificationTitle,
        plan.notificationBody
      );
    }

    const targetStillActive = await options.native.isForegroundTarget(target).catch(() => false);
    if (!targetStillActive) {
      return restoreThenRunFailure(options, snapshot, "rewrite_target_changed", metadata, startedAt);
    }

    try {
      await options.native.writeClipboardPlainText(plan.pasteText);
    } catch {
      return restoreThenRunFailure(options, snapshot, "clipboard_write_failed", metadata, startedAt);
    }

    try {
      await options.native.sendPaste();
      metadata.pasteSent = true;
    } catch {
      return restoreThenRunFailure(options, snapshot, "paste_failed", metadata, startedAt);
    }

    const restored = await restoreSnapshot(options.native, snapshot, metadata, startedAt);
    if (!restored.ok) {
      return restored;
    }

    return {
      ok: true,
      outcome: "succeeded",
      metadata: withDuration(metadata, options.native, startedAt),
      notificationTitle: plan.notificationTitle,
      notificationBody: plan.notificationBody
    };
  } catch {
    return restoreThenRunFailure(options, snapshot, "unexpected_error", metadata, startedAt);
  }
}

function ignoredInFlightResult(): ReplacementFlowRunResult {
  return {
    ok: false,
    outcome: "ignored",
    category: "disabled_app",
    metadata: {},
    notificationTitle: "Rewrite already in progress",
    notificationBody: "The current rewrite must finish before another can start."
  };
}

async function captureOptionalNativeScreenshotContext(
  options: ReplacementFlowRunOptions
): Promise<ScreenshotContextInput | undefined> {
  if (!options.config.screenshotContextEnabled || options.native.captureScreenshotContext === undefined) {
    return undefined;
  }

  try {
    return await options.native.captureScreenshotContext();
  } catch {
    return { ok: false, category: "screenshot_capture_failed" };
  }
}

async function pollForPlainText(
  options: ReplacementFlowRunOptions,
  metadata: ReplacementFlowRewriteMetadata
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

async function restoreThenRunFailure(
  options: ReplacementFlowRunOptions,
  snapshot: ClipboardSnapshot,
  category: MetadataCategory,
  metadata: ReplacementFlowRewriteMetadata,
  startedAt: number,
  providerStatusClass?: ProviderStatusClass,
  notificationTitle?: string,
  notificationBody?: string
): Promise<ReplacementFlowRunResult> {
  const restored = await restoreSnapshot(options.native, snapshot, metadata, startedAt);
  if (!restored.ok) {
    return restored;
  }

  return runFailure(
    category,
    metadata,
    elapsedNative(options.native, startedAt),
    providerStatusClass,
    notificationTitle,
    notificationBody
  );
}

async function restoreSnapshot(
  native: ReplacementFlowNativePrimitives,
  snapshot: ClipboardSnapshot,
  metadata: ReplacementFlowRewriteMetadata,
  startedAt: number
): Promise<{ ok: true } | ReplacementFlowRunResult> {
  try {
    await native.restoreClipboardSnapshot(snapshot);
    metadata.clipboardRestored = true;
    return { ok: true };
  } catch {
    return runFailure("clipboard_restore_failed", metadata, elapsedNative(native, startedAt));
  }
}

function runFailure(
  category: MetadataCategory,
  metadata: ReplacementFlowRewriteMetadata,
  durationMs: number,
  providerStatusClass?: ProviderStatusClass,
  notificationTitle?: string,
  notificationBody?: string
): ReplacementFlowRunResult {
  const notification = notificationTitle === undefined ? notificationForReplacementFlowCategory(category) : undefined;

  return {
    ok: false,
    outcome: "safe_failure",
    category,
    providerStatusClass,
    metadata: {
      ...metadata,
      durationMs
    },
    notificationTitle: notificationTitle ?? notification?.title,
    notificationBody: notificationBody ?? notification?.body
  };
}

function mergePlanMetadata(
  metadata: ReplacementFlowRewriteMetadata,
  planMetadata: ReplacementFlowRewriteMetadata
): void {
  for (const key of [
    "replacementTextCharLength",
    "pasteTextCharLength",
    "screenshotContextEnabled",
    "screenshotContextCaptured",
    "screenshotContextIncluded",
    "screenshotContextDegraded",
    "screenshotContextDegradationCategory",
    "screenshotPayloadSizeClass"
  ] as const) {
    if (planMetadata[key] !== undefined) {
      (metadata as Record<string, unknown>)[key] = planMetadata[key];
    }
  }
}

function withDuration(
  metadata: ReplacementFlowRewriteMetadata,
  native: ReplacementFlowNativePrimitives,
  startedAt: number
): ReplacementFlowRewriteMetadata {
  return {
    ...metadata,
    durationMs: elapsedNative(native, startedAt)
  };
}

function elapsedNative(native: ReplacementFlowNativePrimitives, startedAt: number): number {
  return Math.max(0, native.now() - startedAt);
}

function blocked(category: "disabled_app", durationMs: number): ReplacementFlowRestorePlan {
  return {
    ok: false,
    action: "restore",
    code: "replacement_flow_blocked",
    category,
    metadata: { durationMs },
    notificationTitle: "Rewrite Hotkey disabled",
    notificationBody: "No Azure or paste work was started."
  };
}

function safeFailure(
  category: SafeFailureCategory,
  metadata: ReplacementFlowRewriteMetadata,
  durationMs: number,
  providerStatusClass?: ProviderStatusClass
): ReplacementFlowRestorePlan {
  return {
    ok: false,
    action: "restore",
    code: "replacement_flow_safe_failure",
    category,
    providerStatusClass,
    metadata: {
      ...metadata,
      durationMs
    },
    notificationTitle: notificationForReplacementFlowCategory(category).title,
    notificationBody: notificationForReplacementFlowCategory(category).body
  };
}

function optionalDegradedRewriteNotification(
  metadata: ReplacementFlowRewriteMetadata
): { notificationTitle?: string; notificationBody?: string } {
  return metadata.screenshotContextDegraded === true
    ? {
        notificationTitle: "Rewrite degraded",
        notificationBody: "Screenshot Context was unavailable, so the rewrite used Selected Text only."
      }
    : {};
}

function requiredRewriteNotification(
  metadata: ReplacementFlowRewriteMetadata,
  fallback: { title: string; body: string }
): { notificationTitle: string; notificationBody: string } {
  if (metadata.screenshotContextDegraded === true) {
    return {
      notificationTitle: "Rewrite degraded",
      notificationBody: "Screenshot Context was unavailable, so the rewrite used Selected Text only."
    };
  }

  return {
    notificationTitle: fallback.title,
    notificationBody: fallback.body
  };
}

export function notificationForReplacementFlowCategory(category: MetadataCategory): { title: string; body: string } {
  switch (category) {
    case "disabled_app":
      return {
        title: "Rewrite Hotkey disabled",
        body: "The in-flight rewrite was cancelled. Original selection and clipboard were restored where possible."
      };
    case "configuration_required":
      return {
        title: "Rewrite Hotkey unavailable",
        body: "Open Settings before using Rewrite Hotkey."
      };
    case "rewrite_target_unavailable":
      return {
        title: "Rewrite failed safely",
        body: "The foreground Rewrite Target could not be captured, so no paste work was started."
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
    case "copy_failed":
      return {
        title: "Rewrite failed safely",
        body: "The copy command could not be sent. No Azure or paste work was started."
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
    case "selected_text_empty":
      return {
        title: "No Selected Text captured",
        body: "Select usable text before pressing Rewrite Hotkey."
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
    case "selected_text_too_large":
    case "payload_too_large":
      return {
        title: "Rewrite too large",
        body: "The Selected Text was too large to rewrite safely. Original selection and clipboard were restored where possible."
      };
    case "unexpected_error":
    case "hotkey_registration_conflict":
    case "hotkey_invalid":
      return {
        title: "Rewrite failed safely",
        body: "The Replacement Flow stopped before paste. Original selection and clipboard were restored where possible."
      };
  }
}

function now(options: ReplacementFlowRewriteOptions): number {
  return options.now?.() ?? Date.now();
}

function elapsed(options: ReplacementFlowRewriteOptions, startedAt: number): number {
  return Math.max(0, now(options) - startedAt);
}
