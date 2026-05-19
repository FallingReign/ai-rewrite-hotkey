import assert from "node:assert/strict";
import test from "node:test";
import { validateReplacementText } from "./output-validation.js";

test("accepts useful plain Replacement Text", () => {
  assert.deepEqual(validateReplacementText("this is sort of too long", "This is clearer."), {
    status: "replacement",
    replacementText: "This is clearer."
  });
});

test("rejects empty model output as Safe Failure", () => {
  assert.deepEqual(validateReplacementText("text", "   \n"), {
    status: "safe_failure",
    category: "model_empty_output"
  });
});

test("rejects explanatory output as Safe Failure", () => {
  assert.deepEqual(validateReplacementText("text", "Here is a rewritten version: Better text."), {
    status: "safe_failure",
    category: "model_explanatory_output"
  });
});

test("rejects metadata-like model output as Safe Failure", () => {
  assert.deepEqual(validateReplacementText("text", '{"replacementText":"Better text."}'), {
    status: "safe_failure",
    category: "model_metadata_output"
  });
});

test("rejects ambiguous alternatives as Safe Failure", () => {
  assert.deepEqual(validateReplacementText("text", "Option 1: Better.\nOption 2: Clearer."), {
    status: "safe_failure",
    category: "model_ambiguous_output"
  });
});

test("classifies effectively identical output as a No-Op Rewrite", () => {
  assert.deepEqual(validateReplacementText("  Keep this text.\r\n", "Keep this text.\n"), {
    status: "noop"
  });
});

test("allows JSON-shaped Replacement Text when the Selected Text is JSON-shaped and not metadata-wrapped", () => {
  assert.deepEqual(validateReplacementText('{"message":"hello"}', '{"message":"Hello."}'), {
    status: "replacement",
    replacementText: '{"message":"Hello."}'
  });
});

