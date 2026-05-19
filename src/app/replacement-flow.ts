import { classifySelectedText } from "../capture/selected-text-capture.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import { runTextOnlyRewriteRequest } from "../rewrite/rewrite-request.js";
import type { FetchLike, SafeFailureCategory } from "../rewrite/types.js";
import { deriveRewriteAppState } from "./app-state.js";
import { statusClassForHttpStatus, type MetadataCategory, type ProviderStatusClass } from "./metadata-log.js";

export type ReplacementFlowRewriteCode =
  | "replacement_flow_ready_to_paste"
  | "replacement_flow_noop"
  | "replacement_flow_safe_failure"
  | "replacement_flow_blocked";

export type ReplacementFlowRewriteAction = "paste" | "noop" | "restore";

export interface ReplacementFlowRewriteMetadata {
  selectedTextCharLength?: number;
  usableTextCharLength?: number;
  leadingWrapperLength?: number;
  trailingWrapperLength?: number;
  replacementTextCharLength?: number;
  pasteTextCharLength?: number;
  durationMs?: number;
}

export interface ReplacementFlowRewriteOptions {
  config: RewriteHotkeyConfig;
  selectedText: string;
  fetchFn?: FetchLike;
  now?: () => number;
}

export interface ReplacementFlowPastePlan {
  ok: true;
  action: "paste";
  code: "replacement_flow_ready_to_paste";
  pasteText: string;
  metadata: ReplacementFlowRewriteMetadata;
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
    const result = await runTextOnlyRewriteRequest({
      config: options.config,
      selectedText: captured.usableText,
      fetchFn: options.fetchFn
    });

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
            ...baseMetadata,
            replacementTextCharLength: result.replacementText.length,
            pasteTextCharLength: pasteText.length,
            durationMs
          }
        };
      }
      case "noop":
        return {
          ok: true,
          action: "noop",
          code: "replacement_flow_noop",
          metadata: {
            ...baseMetadata,
            durationMs
          },
          notificationTitle: "No changes suggested",
          notificationBody: "No change was suggested, so the original selection was left untouched."
        };
      case "safe_failure":
        return safeFailure(
          result.category,
          baseMetadata,
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
    notificationTitle: notificationForSafeFailure(category).title,
    notificationBody: notificationForSafeFailure(category).body
  };
}

function notificationForSafeFailure(category: SafeFailureCategory): { title: string; body: string } {
  switch (category) {
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
