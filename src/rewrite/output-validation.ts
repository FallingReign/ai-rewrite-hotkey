import type { RewriteResult, SafeFailureCategory } from "./types.js";

const EXPLANATORY_PREFIX_PATTERN =
  /^(?:here(?:'s| is)|sure\b|certainly\b|of course\b|i (?:rewrote|have rewritten|can|can't|cannot)|rewritten (?:text|version)|replacement text|output|result|answer)\s*[:,-]?/i;
const LABEL_PREFIX_PATTERN = /^(?:rewrite|rewritten|replacement|selected text|final|improved version|version)\s+(?:text|version|output)?\s*:/i;
const AMBIGUOUS_OPTION_PATTERN = /^(?:option|alternative|version)\s*\d+\s*[:.)-]/gim;
const UNSAFE_SELF_REPORT_PATTERN = /^(?:no changes needed|no rewrite needed|i can't|i cannot|unable to rewrite)\b/i;

export function validateReplacementText(selectedText: string, modelOutput: string): RewriteResult {
  const output = normaliseLineEndings(modelOutput);
  const trimmed = output.trim();

  if (trimmed.length === 0) {
    return safeFailure("model_empty_output");
  }

  const metadataCategory = classifyMetadataLikeOutput(trimmed, selectedText);
  if (metadataCategory !== undefined) {
    return safeFailure(metadataCategory);
  }

  if (isExplanatoryOutput(trimmed)) {
    return safeFailure("model_explanatory_output");
  }

  if (isAmbiguousOutput(trimmed)) {
    return safeFailure("model_ambiguous_output");
  }

  if (normaliseForNoOpComparison(trimmed) === normaliseForNoOpComparison(selectedText)) {
    return { status: "noop" };
  }

  return {
    status: "replacement",
    replacementText: output
  };
}

function safeFailure(category: SafeFailureCategory): RewriteResult {
  return { status: "safe_failure", category };
}

function isExplanatoryOutput(output: string): boolean {
  return (
    EXPLANATORY_PREFIX_PATTERN.test(output) ||
    LABEL_PREFIX_PATTERN.test(output) ||
    UNSAFE_SELF_REPORT_PATTERN.test(output)
  );
}

function isAmbiguousOutput(output: string): boolean {
  const matches = output.match(AMBIGUOUS_OPTION_PATTERN);
  return matches !== null && matches.length > 0;
}

function classifyMetadataLikeOutput(output: string, selectedText: string): SafeFailureCategory | undefined {
  if (output.startsWith("```") || output.endsWith("```")) {
    return "model_metadata_output";
  }

  const parsed = parseJson(output);
  if (parsed === undefined) {
    return undefined;
  }

  if (hasWrapperMetadataKeys(parsed)) {
    return "model_metadata_output";
  }

  if (!looksLikeJson(selectedText)) {
    return "model_metadata_output";
  }

  return undefined;
}

function hasWrapperMetadataKeys(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasWrapperMetadataKeys(item));
  }

  if (value === null || typeof value !== "object") {
    return false;
  }

  const wrapperKeys = new Set([
    "replacementText",
    "replacement_text",
    "replacement",
    "rewrittenText",
    "rewritten_text",
    "rewrite",
    "output",
    "explanation",
    "metadata",
    "confidence"
  ]);

  return Object.keys(value).some((key) => wrapperKeys.has(key));
}

function looksLikeJson(value: string): boolean {
  return parseJson(value.trim()) !== undefined;
}

function parseJson(value: string): unknown | undefined {
  const trimmed = value.trim();

  if (!((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function normaliseLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normaliseForNoOpComparison(value: string): string {
  return normaliseLineEndings(value)
    .normalize("NFC")
    .trim()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

