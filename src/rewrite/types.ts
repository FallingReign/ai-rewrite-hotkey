import type { RewriteHotkeyConfig } from "../config/types.js";

export type ChatMessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface RewritePrompt {
  messages: ChatMessage[];
}

export interface RewritePromptInput {
  selectedText: string;
  stylePrompt: string;
}

export interface TextOnlyRewriteRequest {
  config: RewriteHotkeyConfig;
  selectedText: string;
  fetchFn?: FetchLike;
}

export type SafeFailureCategory =
  | "config_invalid"
  | "selected_text_empty"
  | "selected_text_too_large"
  | "style_prompt_empty"
  | "style_prompt_too_large"
  | "payload_too_large"
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

