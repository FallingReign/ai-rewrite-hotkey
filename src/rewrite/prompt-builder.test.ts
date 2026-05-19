import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCKED_GUARDRAILS,
  PLAIN_REPLACEMENT_TEXT_CONTRACT,
  STRUCTURED_TEXT_GUIDANCE,
  buildRewritePrompt
} from "./prompt-builder.js";

test("Prompt Builder combines guardrails, style prompt, selected text, structured guidance, and output contract", () => {
  const prompt = buildRewritePrompt({
    stylePrompt: "Make it clearer and shorter.",
    selectedText: "maybe this needs to be better"
  });
  const systemContent = stringContent(prompt.messages[0]?.content);
  const userContent = stringContent(prompt.messages[1]?.content);

  assert.equal(prompt.messages.length, 2);
  assert.equal(prompt.messages[0]?.role, "system");
  assert.equal(prompt.messages[1]?.role, "user");
  assert.match(systemContent, /Locked Guardrails/);
  assert.match(systemContent, /Preserve names, numbers, dates, URLs, code, commands, and commitments/);
  assert.match(systemContent, /Preserve uncertainty when present/);
  assert.match(systemContent, /use it only as surrounding context/);
  assert.match(systemContent, /Structured Text preservation guidance/);
  assert.match(systemContent, /Plain Replacement Text contract/);
  assert.match(userContent, /Style Prompt:\nMake it clearer and shorter\./);
  assert.match(userContent, /Selected Text:\n<selected_text>\nmaybe this needs to be better\n<\/selected_text>/);
  assert.ok(systemContent.includes(LOCKED_GUARDRAILS));
  assert.ok(systemContent.includes(STRUCTURED_TEXT_GUIDANCE));
  assert.ok(systemContent.includes(PLAIN_REPLACEMENT_TEXT_CONTRACT));
});

test("Prompt Builder does not add provider model names", () => {
  const prompt = buildRewritePrompt({
    stylePrompt: "Keep it natural.",
    selectedText: "test"
  });

  assert.doesNotMatch(JSON.stringify(prompt), /gpt-|model/i);
});

test("Prompt Builder can attach Screenshot Context as multimodal user content without changing the output contract", () => {
  const screenshotBase64 = Buffer.from("fake image bytes").toString("base64");
  const prompt = buildRewritePrompt({
    stylePrompt: "Keep it natural.",
    selectedText: "test",
    screenshotContext: {
      mediaType: "image/jpeg",
      base64: screenshotBase64
    }
  });

  const userContent = prompt.messages[1]?.content;
  assert.equal(Array.isArray(userContent), true);
  assert.deepEqual(Array.isArray(userContent) ? userContent.map((part) => part.type) : [], ["text", "image_url"]);
  assert.match(JSON.stringify(userContent), new RegExp(`data:image/jpeg;base64,${screenshotBase64}`));
  assert.match(stringContent(prompt.messages[0]?.content), /never mention, describe, cite, or imply the screenshot/);
});

function stringContent(content: unknown): string {
  if (typeof content !== "string") {
    assert.fail("expected string content");
  }
  return content;
}

