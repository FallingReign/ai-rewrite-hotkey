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

  assert.equal(prompt.messages.length, 2);
  assert.equal(prompt.messages[0]?.role, "system");
  assert.equal(prompt.messages[1]?.role, "user");
  assert.match(prompt.messages[0]?.content ?? "", /Locked Guardrails/);
  assert.match(prompt.messages[0]?.content ?? "", /Preserve names, numbers, dates, URLs, code, commands, and commitments/);
  assert.match(prompt.messages[0]?.content ?? "", /Preserve uncertainty when present/);
  assert.match(prompt.messages[0]?.content ?? "", /Structured Text preservation guidance/);
  assert.match(prompt.messages[0]?.content ?? "", /Plain Replacement Text contract/);
  assert.match(prompt.messages[1]?.content ?? "", /Style Prompt:\nMake it clearer and shorter\./);
  assert.match(prompt.messages[1]?.content ?? "", /Selected Text:\n<selected_text>\nmaybe this needs to be better\n<\/selected_text>/);
  assert.ok(prompt.messages[0]?.content.includes(LOCKED_GUARDRAILS));
  assert.ok(prompt.messages[0]?.content.includes(STRUCTURED_TEXT_GUIDANCE));
  assert.ok(prompt.messages[0]?.content.includes(PLAIN_REPLACEMENT_TEXT_CONTRACT));
});

test("Prompt Builder does not add provider model names", () => {
  const prompt = buildRewritePrompt({
    stylePrompt: "Keep it natural.",
    selectedText: "test"
  });

  assert.doesNotMatch(JSON.stringify(prompt), /gpt-|model/i);
});

