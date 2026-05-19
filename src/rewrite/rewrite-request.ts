import { validateConfig } from "../config/config.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import {
  resolveScreenshotContext,
  withDegradedScreenshotContext,
  withIncludedScreenshotContext,
  type ScreenshotContextInput,
  type ScreenshotContextMetadata
} from "../screenshot/screenshot-context.js";
import {
  AzureRewriteClient,
  getAzureRequestPayloadSizeBytes,
  SCREENSHOT_REQUEST_PAYLOAD_MAX_BYTES,
  TEXT_ONLY_REQUEST_PAYLOAD_MAX_BYTES
} from "./azure-client.js";
import { RewriteSafeFailureError } from "./errors.js";
import { buildRewritePrompt } from "./prompt-builder.js";
import { validateReplacementText } from "./output-validation.js";
import type { RewritePrompt, RewriteResult, SafeFailureCategory, TextOnlyRewriteRequest } from "./types.js";

export const SELECTED_TEXT_MAX_CHARS = 12000;
export const STYLE_PROMPT_MAX_CHARS = 2000;

interface PreparedTextOnlyRewriteRequest {
  prompt: RewritePrompt;
}

export interface ScreenshotRewriteRequest extends TextOnlyRewriteRequest {
  screenshotContext?: ScreenshotContextInput;
}

export interface ScreenshotRewriteRequestResult {
  result: RewriteResult;
  metadata: ScreenshotContextMetadata;
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

export async function runScreenshotAwareRewriteRequest(
  request: ScreenshotRewriteRequest
): Promise<ScreenshotRewriteRequestResult> {
  if (!validateConfig(request.config).isConfigured) {
    return {
      result: safeFailure("config_invalid"),
      metadata: resolveScreenshotContext(request.config, undefined).metadata
    };
  }

  const preparedTextOnly = prepareTextOnlyRewriteRequest(request.selectedText, request.config.userStylePrompt);
  const screenshot = resolveScreenshotContext(request.config, request.screenshotContext);

  if (!preparedTextOnly.ok) {
    return {
      result: safeFailure(preparedTextOnly.category),
      metadata: screenshot.metadata
    };
  }

  const client = new AzureRewriteClient(request.config, request.fetchFn, { timer: request.timer });

  if (screenshot.status !== "available") {
    return {
      result: await executePreparedRewriteRequest(
        client,
        preparedTextOnly.request.prompt,
        request.selectedText,
        request.abortSignal
      ),
      metadata: screenshot.metadata
    };
  }

  if (!configuredAzurePathSupportsVisionInput(request.config)) {
    return {
      result: await executePreparedRewriteRequest(
        client,
        preparedTextOnly.request.prompt,
        request.selectedText,
        request.abortSignal
      ),
      metadata: withDegradedScreenshotContext(screenshot.metadata, "vision_unsupported")
    };
  }

  const visionPrompt = buildRewritePrompt({
    selectedText: request.selectedText,
    stylePrompt: request.config.userStylePrompt,
    screenshotContext: screenshot.image
  });

  if (getAzureRequestPayloadSizeBytes(visionPrompt) > SCREENSHOT_REQUEST_PAYLOAD_MAX_BYTES) {
    return {
      result: await executePreparedRewriteRequest(
        client,
        preparedTextOnly.request.prompt,
        request.selectedText,
        request.abortSignal
      ),
      metadata: withDegradedScreenshotContext(screenshot.metadata, "screenshot_payload_too_large")
    };
  }

  try {
    return {
      result: validateReplacementText(
        request.selectedText,
        await client.rewrite(visionPrompt, {
          abortSignal: request.abortSignal,
          maxPayloadBytes: SCREENSHOT_REQUEST_PAYLOAD_MAX_BYTES
        })
      ),
      metadata: withIncludedScreenshotContext(screenshot.metadata)
    };
  } catch (error) {
    if (error instanceof RewriteSafeFailureError && error.category === "vision_unsupported") {
      return {
        result: await executePreparedRewriteRequest(
          client,
          preparedTextOnly.request.prompt,
          request.selectedText,
          request.abortSignal
        ),
        metadata: withDegradedScreenshotContext(screenshot.metadata, "vision_unsupported")
      };
    }

    if (error instanceof RewriteSafeFailureError) {
      return {
        result: safeFailure(error.category, error.httpStatus),
        metadata: withIncludedScreenshotContext(screenshot.metadata)
      };
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

async function executePreparedRewriteRequest(
  client: AzureRewriteClient,
  prompt: RewritePrompt,
  selectedText: string,
  abortSignal: AbortSignal | undefined
): Promise<RewriteResult> {
  try {
    return validateReplacementText(selectedText, await client.rewrite(prompt, { abortSignal }));
  } catch (error) {
    if (error instanceof RewriteSafeFailureError) {
      return safeFailure(error.category, error.httpStatus);
    }

    throw error;
  }
}

export function configuredAzurePathSupportsVisionInput(config: RewriteHotkeyConfig): boolean {
  const match = config.azureOpenAIApiVersion.trim().match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (match === null) {
    return false;
  }

  const [, year, month, day] = match;
  const apiDate = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const minimumVisionApiDate = Date.UTC(2024, 1, 15);

  return Number.isFinite(apiDate) && apiDate >= minimumVisionApiDate;
}

