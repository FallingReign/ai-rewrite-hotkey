import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import {
  SCREENSHOT_CONTEXT_IMAGE_MAX_BYTES,
  captureScreenshotContext,
  resolveScreenshotContext
} from "./screenshot-context.js";

const FAKE_BASE64 = Buffer.from("fake screenshot bytes").toString("base64");

test("Screenshot Context is disabled without invoking capture when config turns it off", async () => {
  let captureCalls = 0;
  const result = await captureScreenshotContext(
    {
      ...DEFAULT_CONFIG,
      screenshotContextEnabled: false
    },
    async () => {
      captureCalls += 1;
      return {
        ok: true,
        mediaType: "image/jpeg",
        base64: FAKE_BASE64,
        byteLength: 12
      };
    }
  );

  assert.equal(captureCalls, 0);
  assert.equal(result.status, "disabled");
  assert.equal(result.metadata.screenshotContextEnabled, false);
  assert.equal(result.metadata.screenshotContextIncluded, false);
});

test("Screenshot Context capture stays in memory and exposes only content-free metadata", async () => {
  const outputDirectory = path.join(process.cwd(), ".test-output", "screenshot-context");

  try {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    const result = await captureScreenshotContext(DEFAULT_CONFIG, async () => ({
      ok: true,
      mediaType: "image/jpeg",
      base64: FAKE_BASE64,
      byteLength: 64,
      width: 100,
      height: 50
    }));

    assert.equal(result.status, "available");
    assert.equal(fs.existsSync(outputDirectory), false);
    assert.equal(JSON.stringify(result.metadata).includes(FAKE_BASE64), false);
    assert.equal(result.metadata.screenshotContextCaptured, true);
    assert.equal(result.metadata.screenshotPayloadSizeClass, "small");
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("Screenshot Context capture failures become Degraded Rewrite metadata", async () => {
  const result = await captureScreenshotContext(DEFAULT_CONFIG, async () => {
    throw new Error("screen unavailable");
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.metadata.screenshotContextDegraded, true);
  assert.equal(result.metadata.screenshotContextDegradationCategory, "screenshot_capture_failed");
  assert.equal(JSON.stringify(result.metadata).includes("screen unavailable"), false);
});

test("Screenshot Context rejects invalid or oversized image payloads before request construction", () => {
  const invalid = resolveScreenshotContext(DEFAULT_CONFIG, {
    ok: true,
    mediaType: "image/jpeg",
    base64: "not-base64",
    byteLength: 12
  });
  const oversized = resolveScreenshotContext(DEFAULT_CONFIG, {
    ok: true,
    mediaType: "image/jpeg",
    base64: FAKE_BASE64,
    byteLength: SCREENSHOT_CONTEXT_IMAGE_MAX_BYTES + 1
  });

  assert.equal(invalid.status, "degraded");
  assert.equal(invalid.metadata.screenshotContextDegradationCategory, "screenshot_processing_failed");
  assert.equal(oversized.status, "degraded");
  assert.equal(oversized.metadata.screenshotContextDegradationCategory, "screenshot_payload_too_large");
  assert.equal(oversized.metadata.screenshotPayloadSizeClass, "too_large");
});
