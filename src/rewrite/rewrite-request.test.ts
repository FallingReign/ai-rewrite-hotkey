import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import {
  configuredAzurePathSupportsVisionInput,
  prepareTextOnlyRewriteRequest,
  runScreenshotAwareRewriteRequest,
  runTextOnlyRewriteRequest,
  SELECTED_TEXT_MAX_CHARS
} from "./rewrite-request.js";
import type { FetchLike } from "./types.js";

const CONFIG: RewriteHotkeyConfig = {
  ...DEFAULT_CONFIG,
  azureOpenAIEndpoint: "https://rewrite-test.cognitiveservices.azure.com",
  azureOpenAIApiKey: "unit-test-key",
  azureOpenAIDeployment: "rewrite-deployment",
  azureOpenAIApiVersion: "2025-01-01-preview"
};
const SCREENSHOT_CONTEXT = {
  ok: true as const,
  mediaType: "image/jpeg" as const,
  base64: Buffer.from("fake screenshot bytes").toString("base64"),
  byteLength: 128,
  width: 64,
  height: 32
};

test("text-only Rewrite Request returns accepted Replacement Text from Azure output", async () => {
  const fetchFn: FetchLike = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "This is clearer." } }] }), { status: 200 });

  assert.deepEqual(
    await runTextOnlyRewriteRequest({
      config: CONFIG,
      selectedText: "this is maybe not clear",
      fetchFn
    }),
    {
      status: "replacement",
      replacementText: "This is clearer."
    }
  );
});

test("text-only Rewrite Request returns Safe Failure for invalid config without calling Azure", async () => {
  let calls = 0;
  const fetchFn: FetchLike = async () => {
    calls += 1;
    return new Response("{}");
  };

  assert.deepEqual(
    await runTextOnlyRewriteRequest({
      config: DEFAULT_CONFIG,
      selectedText: "text",
      fetchFn
    }),
    {
      status: "safe_failure",
      category: "config_invalid"
    }
  );
  assert.equal(calls, 0);
});

test("text-only Rewrite Request enforces selected text limits before Azure", () => {
  assert.deepEqual(prepareTextOnlyRewriteRequest("", CONFIG.userStylePrompt), {
    ok: false,
    category: "selected_text_empty"
  });

  assert.deepEqual(prepareTextOnlyRewriteRequest("x".repeat(SELECTED_TEXT_MAX_CHARS + 1), CONFIG.userStylePrompt), {
    ok: false,
    category: "selected_text_too_large"
  });
});

test("text-only Rewrite Request enforces no-op classification", async () => {
  const fetchFn: FetchLike = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "Same text." } }] }), { status: 200 });

  assert.deepEqual(
    await runTextOnlyRewriteRequest({
      config: CONFIG,
      selectedText: " Same text.\n",
      fetchFn
    }),
    { status: "noop" }
  );
});

test("Screenshot-aware Rewrite Request includes Screenshot Context only for vision-capable API paths", async () => {
  let requestBody = "";

  const result = await runScreenshotAwareRewriteRequest({
    config: CONFIG,
    selectedText: "make this clearer",
    screenshotContext: SCREENSHOT_CONTEXT,
    fetchFn: async (_input, init) => {
      requestBody = String(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "This is clearer." } }] }), { status: 200 });
    }
  });

  assert.equal(result.result.status, "replacement");
  assert.equal(result.metadata.screenshotContextIncluded, true);
  assert.equal(result.metadata.screenshotContextDegraded, false);
  assert.match(requestBody, /"type":"image_url"/);
  assert.match(requestBody, new RegExp(SCREENSHOT_CONTEXT.base64));
});

test("Screenshot-aware Rewrite Request degrades to text-only when the configured API path is not vision-capable", async () => {
  const bodies: string[] = [];

  const result = await runScreenshotAwareRewriteRequest({
    config: {
      ...CONFIG,
      azureOpenAIApiVersion: "2023-12-01-preview"
    },
    selectedText: "make this clearer",
    screenshotContext: SCREENSHOT_CONTEXT,
    fetchFn: async (_input, init) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "This is clearer." } }] }), { status: 200 });
    }
  });

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.includes(SCREENSHOT_CONTEXT.base64), false);
  assert.equal(result.metadata.screenshotContextDegraded, true);
  assert.equal(result.metadata.screenshotContextDegradationCategory, "vision_unsupported");
});

test("Screenshot-aware Rewrite Request enforces screenshot payload limits before sending image data", async () => {
  const bodies: string[] = [];
  const result = await runScreenshotAwareRewriteRequest({
    config: CONFIG,
    selectedText: "make this clearer",
    screenshotContext: {
      ...SCREENSHOT_CONTEXT,
      byteLength: 1024 * 1024
    },
    fetchFn: async (_input, init) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "This is clearer." } }] }), { status: 200 });
    }
  });

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.includes(SCREENSHOT_CONTEXT.base64), false);
  assert.equal(result.metadata.screenshotContextDegraded, true);
  assert.equal(result.metadata.screenshotContextDegradationCategory, "screenshot_payload_too_large");
});

test("Screenshot-aware Rewrite Request retries once as text-only only for vision unsupported responses", async () => {
  const bodies: string[] = [];
  const result = await runScreenshotAwareRewriteRequest({
    config: CONFIG,
    selectedText: "make this clearer",
    screenshotContext: SCREENSHOT_CONTEXT,
    fetchFn: async (_input, init) => {
      bodies.push(String(init.body));
      if (bodies.length === 1) {
        return new Response(JSON.stringify({ error: { message: "image_url is not supported by this deployment" } }), {
          status: 400
        });
      }

      return new Response(JSON.stringify({ choices: [{ message: { content: "This is clearer." } }] }), { status: 200 });
    }
  });

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0]?.includes(SCREENSHOT_CONTEXT.base64), true);
  assert.equal(bodies[1]?.includes(SCREENSHOT_CONTEXT.base64), false);
  assert.equal(result.result.status, "replacement");
  assert.equal(result.metadata.screenshotContextDegraded, true);
  assert.equal(result.metadata.screenshotContextDegradationCategory, "vision_unsupported");
});

test("Screenshot-aware Rewrite Request does not retry general Azure failures", async () => {
  let calls = 0;
  const result = await runScreenshotAwareRewriteRequest({
    config: CONFIG,
    selectedText: "make this clearer",
    screenshotContext: SCREENSHOT_CONTEXT,
    fetchFn: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "general provider failure" } }), { status: 503 });
    }
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.result, {
    status: "safe_failure",
    category: "azure_http_error",
    httpStatus: 503
  });
  assert.equal(result.metadata.screenshotContextIncluded, true);
});

test("vision support is inferred conservatively from Azure API version date", () => {
  assert.equal(configuredAzurePathSupportsVisionInput(CONFIG), true);
  assert.equal(
    configuredAzurePathSupportsVisionInput({
      ...CONFIG,
      azureOpenAIApiVersion: "2024-01-01-preview"
    }),
    false
  );
});

