import type { RewriteHotkeyConfig } from "../config/types.js";
import { runTextOnlyRewriteRequest } from "../rewrite/rewrite-request.js";
import type { FetchLike, SafeFailureCategory } from "../rewrite/types.js";
import { deriveRewriteAppState } from "./app-state.js";
import type { MetadataCategory, MetadataLogger, ProviderStatusClass } from "./metadata-log.js";
import { statusClassForHttpStatus } from "./metadata-log.js";

export const BUILT_IN_TEST_REWRITE_SAMPLE =
  "i think this is probably fine but it could be a bit clearer and less wordy before I send it";

export type TestRewriteCode =
  | "test_rewrite_succeeded"
  | "test_rewrite_noop"
  | "test_rewrite_safe_failure"
  | "test_rewrite_blocked";

export interface SafeTestRewriteOutcome {
  ok: boolean;
  code: TestRewriteCode;
  notificationTitle: string;
  notificationBody: string;
  category?: MetadataCategory;
  providerStatusClass?: ProviderStatusClass;
}

export interface SafeTestRewriteOptions {
  config: RewriteHotkeyConfig;
  fetchFn?: FetchLike;
  logEvent?: MetadataLogger;
}

export async function runSafeTestRewrite(options: SafeTestRewriteOptions): Promise<SafeTestRewriteOutcome> {
  const state = deriveRewriteAppState(options.config);

  if (!state.enabled) {
    logSafely(options.logEvent, {
      event: "test_rewrite_finished",
      configured: state.configured,
      enabled: state.enabled,
      hotkeyRegistrationAllowed: state.hotkeyRegistrationAllowed,
      outcome: "blocked",
      category: "disabled_app"
    });

    return {
      ok: false,
      code: "test_rewrite_blocked",
      notificationTitle: "Test Rewrite blocked",
      notificationBody: "Enable Rewrite Hotkey before running Test Rewrite.",
      category: "disabled_app"
    };
  }

  const startedAt = Date.now();
  logSafely(options.logEvent, {
    event: "test_rewrite_started",
    configured: state.configured,
    enabled: state.enabled,
    hotkeyRegistrationAllowed: state.hotkeyRegistrationAllowed
  });

  try {
    const result = await runTextOnlyRewriteRequest({
      config: options.config,
      selectedText: BUILT_IN_TEST_REWRITE_SAMPLE,
      fetchFn: options.fetchFn
    });

    const durationMs = Date.now() - startedAt;

    switch (result.status) {
      case "replacement":
        logSafely(options.logEvent, {
          event: "test_rewrite_finished",
          configured: state.configured,
          enabled: state.enabled,
          hotkeyRegistrationAllowed: state.hotkeyRegistrationAllowed,
          outcome: "succeeded",
          durationMs
        });

        return {
          ok: true,
          code: "test_rewrite_succeeded",
          notificationTitle: "Test Rewrite succeeded",
          notificationBody: "Azure settings were validated with the built-in sample."
        };
      case "noop":
        logSafely(options.logEvent, {
          event: "test_rewrite_finished",
          configured: state.configured,
          enabled: state.enabled,
          hotkeyRegistrationAllowed: state.hotkeyRegistrationAllowed,
          outcome: "noop",
          durationMs
        });

        return {
          ok: true,
          code: "test_rewrite_noop",
          notificationTitle: "Test Rewrite completed",
          notificationBody: "Azure settings responded, but the sample did not need changes."
        };
      case "safe_failure":
        return safeFailureOutcome(
          state.configured,
          state.enabled,
          state.hotkeyRegistrationAllowed,
          result.category,
          statusClassForHttpStatus(result.httpStatus),
          durationMs,
          options.logEvent
        );
    }
  } catch {
    return safeFailureOutcome(
      state.configured,
      state.enabled,
      state.hotkeyRegistrationAllowed,
      "unexpected_error",
      undefined,
      Date.now() - startedAt,
      options.logEvent
    );
  }
}

function safeFailureOutcome(
  configured: boolean,
  enabled: boolean,
  hotkeyRegistrationAllowed: boolean,
  category: SafeFailureCategory,
  providerStatusClass: ProviderStatusClass | undefined,
  durationMs: number,
  logEvent: MetadataLogger | undefined
): SafeTestRewriteOutcome {
  logSafely(logEvent, {
    event: "test_rewrite_finished",
    configured,
    enabled,
    hotkeyRegistrationAllowed,
    outcome: "safe_failure",
    category,
    providerStatusClass,
    durationMs
  });

  return {
    ok: false,
    code: "test_rewrite_safe_failure",
    notificationTitle: "Test Rewrite failed safely",
    notificationBody: "Check Settings and connection. No private rewrite content was shown or logged.",
    category,
    providerStatusClass
  };
}

function logSafely(logEvent: MetadataLogger | undefined, event: Parameters<MetadataLogger>[0]): void {
  try {
    logEvent?.(event);
  } catch {
    // Logging must never turn a safe Test Rewrite into a user-visible failure.
  }
}
