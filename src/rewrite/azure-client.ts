import type { RewriteHotkeyConfig } from "../config/types.js";
import { RewriteSafeFailureError } from "./errors.js";
import type { FetchLike, RewritePrompt } from "./types.js";

export const TEXT_ONLY_REQUEST_PAYLOAD_MAX_BYTES = 32768;

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

  constructor(config: RewriteHotkeyConfig, fetchFn: FetchLike = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  async rewrite(prompt: RewritePrompt): Promise<string> {
    const body = buildAzureChatCompletionsBody(prompt);
    const payload = JSON.stringify(body);

    if (Buffer.byteLength(payload, "utf8") > TEXT_ONLY_REQUEST_PAYLOAD_MAX_BYTES) {
      throw new RewriteSafeFailureError("payload_too_large");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

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

      if (!response.ok) {
        throw new RewriteSafeFailureError("azure_http_error", { httpStatus: response.status });
      }

      return extractReplacementCandidate(await readJsonResponse(response));
    } catch (error) {
      if (error instanceof RewriteSafeFailureError) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new RewriteSafeFailureError("azure_timeout");
      }

      throw new RewriteSafeFailureError("azure_network_error");
    } finally {
      clearTimeout(timeout);
    }
  }
}

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

function extractReplacementCandidate(responseBody: AzureChatCompletionsResponseBody): string {
  const content = responseBody.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new RewriteSafeFailureError("azure_malformed_response");
  }

  return content;
}

