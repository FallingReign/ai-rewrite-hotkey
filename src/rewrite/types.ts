import type { RewriteHotkeyConfig } from "../config/types.js";

export type ChatMessageRole = "system" | "user" | "assistant";

export interface ChatTextContentPart {
  type: "text";
  text: string;
}

export interface ChatImageUrlContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
}

export type ChatMessageContentPart = ChatTextContentPart | ChatImageUrlContentPart;
export type ChatMessageContent = string | ChatMessageContentPart[];

export interface ChatMessage {
  role: ChatMessageRole;
  content: ChatMessageContent;
}

export interface RewritePrompt {
  messages: ChatMessage[];
}

export interface RewritePromptInput {
  selectedText: string;
  stylePrompt: string;
  screenshotContext?: {
    mediaType: "image/jpeg" | "image/png" | "image/webp";
    base64: string;
  };
}

export interface TextOnlyRewriteRequest {
  config: RewriteHotkeyConfig;
  selectedText: string;
  fetchFn?: FetchLike;
  abortSignal?: AbortSignal;
  timer?: RewriteTimer;
}

export type SafeFailureCategory =
  | "config_invalid"
  | "selected_text_empty"
  | "selected_text_too_large"
  | "style_prompt_empty"
  | "style_prompt_too_large"
  | "payload_too_large"
  | "vision_unsupported"
  | "azure_timeout"
  | "azure_network_error"
  | "azure_http_error"
  | "azure_malformed_response"
  | "model_empty_output"
  | "model_explanatory_output"
  | "model_metadata_output"
  | "model_ambiguous_output"
  | "unexpected_error";

export interface SafeFailureResult {
  status: "safe_failure";
  category: SafeFailureCategory;
  httpStatus?: number;
}

export interface ReplacementResult {
  status: "replacement";
  replacementText: string;
}

export interface NoOpRewriteResult {
  status: "noop";
}

export type RewriteResult = ReplacementResult | NoOpRewriteResult | SafeFailureResult;

export type FetchLike = (input: string | URL, init: RequestInit) => Promise<Response>;

export interface RewriteTimer {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

