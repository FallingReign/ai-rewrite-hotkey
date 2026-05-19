import { validateConfig } from "../config/config.js";
import { AzureRewriteClient, getAzureRequestPayloadSizeBytes, TEXT_ONLY_REQUEST_PAYLOAD_MAX_BYTES } from "./azure-client.js";
import { RewriteSafeFailureError } from "./errors.js";
import { buildRewritePrompt } from "./prompt-builder.js";
import { validateReplacementText } from "./output-validation.js";
import type { RewritePrompt, RewriteResult, SafeFailureCategory, TextOnlyRewriteRequest } from "./types.js";

export const SELECTED_TEXT_MAX_CHARS = 12000;
export const STYLE_PROMPT_MAX_CHARS = 2000;

interface PreparedTextOnlyRewriteRequest {
  prompt: RewritePrompt;
}

type PrepareResult =
  | {
      ok: true;
      request: PreparedTextOnlyRewriteRequest;
    }
  | {
      ok: false;
      category: SafeFailureCategory;
    };

export async function runTextOnlyRewriteRequest(request: TextOnlyRewriteRequest): Promise<RewriteResult> {
  if (!validateConfig(request.config).isConfigured) {
    return safeFailure("config_invalid");
  }

  const prepared = prepareTextOnlyRewriteRequest(request.selectedText, request.config.userStylePrompt);

  if (!prepared.ok) {
    return safeFailure(prepared.category);
  }

  const client = new AzureRewriteClient(request.config, request.fetchFn, { timer: request.timer });

  try {
    const modelOutput = await client.rewrite(prepared.request.prompt, { abortSignal: request.abortSignal });
    return validateReplacementText(request.selectedText, modelOutput);
  } catch (error) {
    if (error instanceof RewriteSafeFailureError) {
      return safeFailure(error.category, error.httpStatus);
    }

    throw error;
  }
}

export function prepareTextOnlyRewriteRequest(selectedText: string, stylePrompt: string): PrepareResult {
  if (selectedText.trim().length === 0) {
    return { ok: false, category: "selected_text_empty" };
  }

  if (selectedText.length > SELECTED_TEXT_MAX_CHARS) {
    return { ok: false, category: "selected_text_too_large" };
  }

  if (stylePrompt.trim().length === 0) {
    return { ok: false, category: "style_prompt_empty" };
  }

  if (stylePrompt.length > STYLE_PROMPT_MAX_CHARS) {
    return { ok: false, category: "style_prompt_too_large" };
  }

  const prompt = buildRewritePrompt({ selectedText, stylePrompt });

  if (getAzureRequestPayloadSizeBytes(prompt) > TEXT_ONLY_REQUEST_PAYLOAD_MAX_BYTES) {
    return { ok: false, category: "payload_too_large" };
  }

  return {
    ok: true,
    request: {
      prompt
    }
  };
}

function safeFailure(category: SafeFailureCategory, httpStatus?: number): RewriteResult {
  return httpStatus === undefined ? { status: "safe_failure", category } : { status: "safe_failure", category, httpStatus };
}

