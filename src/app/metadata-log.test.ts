import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  appendMetadataLogEvent,
  getRotatedMetadataLogPath,
  type MetadataLogEvent
} from "./metadata-log.js";

const PRIVATE_MARKERS = [
  "raw selected text",
  "raw replacement text",
  "secret-api-key",
  "provider payload detail",
  Buffer.from("fake screenshot bytes").toString("base64")
];

test("metadata logs keep only whitelisted content-free fields", () => {
  const outputDirectory = path.join(process.cwd(), ".test-output", "metadata-log-private");
  const logPath = path.join(outputDirectory, "metadata.jsonl");
  const event = {
    event: "replacement_flow_finished",
    outcome: "safe_failure",
    category: "azure_http_error",
    providerStatusClass: "5xx",
    selectedText: PRIVATE_MARKERS[0],
    replacementText: PRIVATE_MARKERS[1],
    azureOpenAIApiKey: PRIVATE_MARKERS[2],
    providerPayload: PRIVATE_MARKERS[3],
    screenshotBase64: PRIVATE_MARKERS[4]
  } as MetadataLogEvent & Record<string, unknown>;

  try {
    appendMetadataLogEvent(event, logPath);
    const log = fs.readFileSync(logPath, "utf8");

    assert.match(log, /"category":"azure_http_error"/);
    assert.match(log, /"providerStatusClass":"5xx"/);
    for (const marker of PRIVATE_MARKERS) {
      assert.equal(log.includes(marker), false);
    }
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("metadata logs rotate before growing beyond the configured bound", () => {
  const outputDirectory = path.join(process.cwd(), ".test-output", "metadata-log-rotation");
  const logPath = path.join(outputDirectory, "metadata.jsonl");
  const maxBytes = 900;

  try {
    for (let index = 0; index < 40; index += 1) {
      appendMetadataLogEvent(
        {
          event: "replacement_flow_finished",
          outcome: "safe_failure",
          category: "azure_timeout",
          durationMs: index
        },
        logPath,
        maxBytes
      );
    }

    assert.equal(fs.existsSync(getRotatedMetadataLogPath(logPath)), true);
    assert.equal(fs.statSync(logPath).size <= maxBytes, true);
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});
