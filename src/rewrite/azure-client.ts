import type { RewriteHotkeyConfig } from "../config/types.js";
import { RewriteSafeFailureError } from "./errors.js";
import type { FetchLike, RewritePrompt } from "./types.js";

export const TEXT_ONLY_REQUEST_PAYLOAD_MAX_BYTES = 32768;
export const SCREENSHOT_REQUEST_PAYLOAD_MAX_BYTES = 1024 * 1024;

export interface RewriteTimer {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AzureRewriteClientOptions {
  timer?: RewriteTimer;
}

export interface AzureRewriteRequestOptions {
  abortSignal?: AbortSignal;
  maxPayloadBytes?: number;
}

interface AzureChatCompletionsRequestBody {
  messages: RewritePrompt["messages"];
}

interface AzureChatCompletionsResponseBody {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

export class AzureRewriteClient {
  private readonly config: RewriteHotkeyConfig;
  private readonly fetchFn: FetchLike;
  private readonly timer: RewriteTimer;

  constructor(config: RewriteHotkeyConfig, fetchFn: FetchLike = fetch, options: AzureRewriteClientOptions = {}) {
    this.config = config;
    this.fetchFn = fetchFn;
    this.timer = options.timer ?? defaultRewriteTimer;
  }

  async rewrite(prompt: RewritePrompt, options: AzureRewriteRequestOptions = {}): Promise<string> {
    const body = buildAzureChatCompletionsBody(prompt);
    const payload = JSON.stringify(body);
    const maxPayloadBytes = options.maxPayloadBytes ?? TEXT_ONLY_REQUEST_PAYLOAD_MAX_BYTES;

    if (Buffer.byteLength(payload, "utf8") > maxPayloadBytes) {
      throw new RewriteSafeFailureError("payload_too_large");
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = this.timer.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    const abortFromCaller = () => controller.abort();

    if (options.abortSignal?.aborted) {
      controller.abort();
    } else {
      options.abortSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      const response = await this.fetchFn(buildAzureChatCompletionsUrl(this.config), {
        method: "POST",
        headers: {
          "api-key": this.config.azureOpenAIApiKey,
          "content-type": "application/json"
        },
        body: payload,
        signal: controller.signal
      });

      if (controller.signal.aborted) {
        throw new RewriteSafeFailureError(timedOut ? "azure_timeout" : "unexpected_error");
      }

      if (!response.ok) {
        const errorBody = await readErrorResponse(response);
        if (promptHasImageInput(prompt) && isVisionUnsupportedHttpError(response.status, errorBody)) {
          throw new RewriteSafeFailureError("vision_unsupported", { httpStatus: response.status });
        }

        throw new RewriteSafeFailureError("azure_http_error", { httpStatus: response.status });
      }

      return extractReplacementCandidate(await readJsonResponse(response));
    } catch (error) {
      if (error instanceof RewriteSafeFailureError) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new RewriteSafeFailureError(timedOut ? "azure_timeout" : "unexpected_error");
      }

      throw new RewriteSafeFailureError("azure_network_error");
    } finally {
      this.timer.clearTimeout(timeout);
      options.abortSignal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

const defaultRewriteTimer: RewriteTimer = {
  setTimeout(callback, ms) {
    return globalThis.setTimeout(callback, ms);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  }
};

export function buildAzureChatCompletionsBody(prompt: RewritePrompt): AzureChatCompletionsRequestBody {
  return {
    messages: prompt.messages
  };
}

export function getAzureRequestPayloadSizeBytes(prompt: RewritePrompt): number {
  return Buffer.byteLength(JSON.stringify(buildAzureChatCompletionsBody(prompt)), "utf8");
}

export function buildAzureChatCompletionsUrl(config: RewriteHotkeyConfig): string {
  const endpoint = config.azureOpenAIEndpoint.trim().replace(/\/+$/, "");
  const deployment = encodeURIComponent(config.azureOpenAIDeployment.trim());
  const apiVersion = encodeURIComponent(config.azureOpenAIApiVersion.trim());

  return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
}

async function readJsonResponse(response: Response): Promise<AzureChatCompletionsResponseBody> {
  try {
    return (await response.json()) as AzureChatCompletionsResponseBody;
  } catch {
    throw new RewriteSafeFailureError("azure_malformed_response");
  }
}

async function readErrorResponse(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 4096);
  } catch {
    return "";
  }
}

function promptHasImageInput(prompt: RewritePrompt): boolean {
  return prompt.messages.some((message) =>
    Array.isArray(message.content)
      ? message.content.some((part) => part.type === "image_url" && part.image_url.url.startsWith("data:image/"))
      : false
  );
}

function isVisionUnsupportedHttpError(status: number, body: string): boolean {
  if (![400, 404, 415, 422].includes(status)) {
    return false;
  }

  const text = body.toLowerCase();
  const mentionsVisionInput =
    text.includes("image_url") ||
    text.includes("image input") ||
    text.includes("vision") ||
    text.includes("multimodal") ||
    text.includes("multi-modal") ||
    text.includes("content part");
  const mentionsUnsupported =
    text.includes("unsupported") ||
    text.includes("not supported") ||
    text.includes("does not support") ||
    text.includes("invalid") ||
    text.includes("unknown");

  return mentionsVisionInput && mentionsUnsupported;
}

function extractReplacementCandidate(responseBody: AzureChatCompletionsResponseBody): string {
  const content = responseBody.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new RewriteSafeFailureError("azure_malformed_response");
  }

  return content;
}

