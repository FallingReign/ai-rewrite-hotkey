import { screenshotContextDataUrl } from "../screenshot/screenshot-context.js";
import type { RewritePrompt, RewritePromptInput } from "./types.js";

export const LOCKED_GUARDRAILS = [
  "Locked Guardrails:",
  "- You rewrite Selected Text for direct replacement in the user's current app.",
  "- Preserve the user's meaning, facts, intent, and point of view.",
  "- Preserve names, numbers, dates, URLs, code, commands, and commitments.",
  "- Preserve uncertainty when present.",
  "- Do not add unsupported claims, examples, citations, emojis, signatures, apologies, enthusiasm, warmth, or certainty unless clearly implied.",
  "- If Screenshot Context is provided, use it only as surrounding context for interpreting the Selected Text; never mention, describe, cite, or imply the screenshot in Replacement Text.",
  "- Apply the Style Prompt only when it does not conflict with these Locked Guardrails.",
  "- If no useful rewrite is possible, return the original Selected Text without explanation."
].join("\n");

export const STRUCTURED_TEXT_GUIDANCE = [
  "Structured Text preservation guidance:",
  "- The Selected Text may be code, commands, JSON, logs, URLs, terminal output, or another syntax-sensitive format.",
  "- Preserve syntax, indentation, delimiters, placeholders, paths, flags, identifiers, and line structure unless changing prose around them.",
  "- Do not wrap Structured Text in Markdown fences unless those fences are already part of the Selected Text."
].join("\n");

export const PLAIN_REPLACEMENT_TEXT_CONTRACT = [
  "Plain Replacement Text contract:",
  "- Return exactly one plain-text Replacement Text value.",
  "- Do not include labels, prefaces, explanations, alternatives, metadata, JSON wrappers, Markdown fences, or quotes around the answer.",
  "- The returned text must be directly pasteable over the Selected Text."
].join("\n");

export function buildRewritePrompt(input: RewritePromptInput): RewritePrompt {
  const selectedText = input.selectedText;
  const stylePrompt = input.stylePrompt.trim();
  const userText = [
    "Style Prompt:",
    stylePrompt,
    "",
    "Selected Text:",
    "<selected_text>",
    selectedText,
    "</selected_text>",
    "",
    "Rewrite the Selected Text now. Return only Replacement Text."
  ].join("\n");

  return {
    messages: [
      {
        role: "system",
        content: [LOCKED_GUARDRAILS, STRUCTURED_TEXT_GUIDANCE, PLAIN_REPLACEMENT_TEXT_CONTRACT].join("\n\n")
      },
      {
        role: "user",
        content:
          input.screenshotContext === undefined
            ? userText
            : [
                {
                  type: "text",
                  text: userText
                },
                {
                  type: "image_url",
                  image_url: {
                    url: screenshotContextDataUrl({
                      ...input.screenshotContext,
                      byteLength: 1
                    }),
                    detail: "low"
                  }
                }
              ]
      }
    ]
  };
}

