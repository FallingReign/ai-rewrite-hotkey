import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import { deriveRewriteAppState } from "../app/app-state.js";
import {
  classifySelectedText,
  runSelectedTextCapture,
  toContentFreeSelectedTextCaptureView,
  type ClipboardSnapshot,
  type RewriteTarget,
  type SelectedTextNativePrimitives
} from "./selected-text-capture.js";

const CONFIGURED_CONFIG: RewriteHotkeyConfig = {
  ...DEFAULT_CONFIG,
  azureOpenAIEndpoint: "https://rewrite-test.cognitiveservices.azure.com",
  azureOpenAIApiKey: "unit-test-key",
  azureOpenAIDeployment: "rewrite-deployment",
  azureOpenAIApiVersion: "2025-01-01-preview"
};

test("capture records the Rewrite Target and Clipboard Snapshot before copy, then restores after usable text", async () => {
  const native = new FakeNativePrimitives({ clipboardReads: ["  rewrite me\r\n"] });

  const outcome = await runSelectedTextCapture({
    state: deriveRewriteAppState(CONFIGURED_CONFIG),
    native
  });

  assert.equal(outcome.ok, true);
  assert.deepEqual(native.calls, ["capture-target", "capture-snapshot", "send-copy", "read-clipboard", "restore-snapshot"]);

  if (!outcome.ok) {
    assert.fail("expected capture success");
  }

  assert.equal(outcome.selectedText.usableText, "rewrite me");
  assert.deepEqual(outcome.selectedText.wrappers, { leading: "  ", trailing: "\r\n" });
  assert.equal(outcome.metadata.leadingWrapperLength, 2);
  assert.equal(outcome.metadata.trailingWrapperLength, 2);
  assert.equal(outcome.metadata.clipboardRestored, true);
});

test("Clipboard Snapshot failure causes Safe Failure before copy", async () => {
  const native = new FakeNativePrimitives({ snapshotError: new Error("snapshot unavailable") });

  const outcome = await runSelectedTextCapture({
    state: deriveRewriteAppState(CONFIGURED_CONFIG),
    native
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.category, "clipboard_snapshot_failed");
  assert.deepEqual(native.calls, ["capture-target", "capture-snapshot"]);
  assert.equal(outcome.metadata.copySent, false);
});

test("no Selected Text polls briefly, restores the Clipboard Snapshot, and returns content-free failure", async () => {
  const native = new FakeNativePrimitives({ clipboardReads: [null, null, null], tickMs: 300 });

  const outcome = await runSelectedTextCapture({
    state: deriveRewriteAppState(CONFIGURED_CONFIG),
    native,
    pollTimeoutMs: 900,
    pollIntervalMs: 50
  });
  const contentFree = toContentFreeSelectedTextCaptureView(outcome);

  assert.equal(outcome.ok, false);
  assert.equal(outcome.category, "selected_text_empty");
  assert.deepEqual(native.calls, [
    "capture-target",
    "capture-snapshot",
    "send-copy",
    "read-clipboard",
    "sleep",
    "read-clipboard",
    "restore-snapshot"
  ]);
  assert.equal(contentFree.notificationBody.includes("No Azure or paste work"), true);
  assert.equal(JSON.stringify(contentFree).includes("rewrite me"), false);
});

test("whitespace-only Selected Text is not usable and still restores the Clipboard Snapshot", async () => {
  const native = new FakeNativePrimitives({ clipboardReads: [" \n\t "] });

  const outcome = await runSelectedTextCapture({
    state: deriveRewriteAppState(CONFIGURED_CONFIG),
    native
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.category, "selected_text_empty");
  assert.equal(outcome.metadata.clipboardRestored, true);
  assert.equal(outcome.metadata.selectedTextCharLength, undefined);
});

test("Selected Text matching the previous clipboard value is still valid", async () => {
  const native = new FakeNativePrimitives({
    snapshot: { id: "snapshot", previousPlainText: "same text" },
    clipboardReads: ["same text"]
  });

  const outcome = await runSelectedTextCapture({
    state: deriveRewriteAppState(CONFIGURED_CONFIG),
    native
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected matching clipboard text to be accepted");
  }
  assert.equal(outcome.selectedText.usableText, "same text");
});

test("Structured Text is accepted as explicit plain clipboard selection without terminal parsing", async () => {
  const structuredSelections = [
    "{\"ok\": true, \"items\": [1, 2]}",
    "curl -H \"Accept: application/json\" https://example.test",
    "ERROR 2026-05-19 failed to connect",
    "https://example.test/path?query=true",
    "$env:Path -split ';'"
  ];

  for (const selectedText of structuredSelections) {
    const native = new FakeNativePrimitives({ clipboardReads: [selectedText] });
    const outcome = await runSelectedTextCapture({
      state: deriveRewriteAppState(CONFIGURED_CONFIG),
      native
    });

    assert.equal(outcome.ok, true);
    assert.equal(native.calls.includes("parse-terminal-buffer"), false);
  }
});

test("Disabled App blocks capture before native clipboard or target side effects", async () => {
  const native = new FakeNativePrimitives({ clipboardReads: ["text"] });

  const outcome = await runSelectedTextCapture({
    state: deriveRewriteAppState({ ...CONFIGURED_CONFIG, enabled: false }),
    native
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.category, "disabled_app");
  assert.deepEqual(native.calls, []);
});

test("classification preserves wrapper text internally while content-free view strips Private Rewrite Content", () => {
  const captured = classifySelectedText("\n\t{\n  \"ok\": true\n}\r\n");

  assert.notEqual(captured, null);
  assert.equal(captured?.usableText, "{\n  \"ok\": true\n}");
  assert.deepEqual(captured?.wrappers, { leading: "\n\t", trailing: "\r\n" });
});

class FakeNativePrimitives implements SelectedTextNativePrimitives {
  readonly calls: string[] = [];
  private readonly target: RewriteTarget;
  private readonly snapshot: ClipboardSnapshot;
  private readonly clipboardReads: Array<string | null>;
  private readonly snapshotError: Error | undefined;
  private readonly tickMs: number;
  private currentTimeMs = 0;

  constructor(options: {
    target?: RewriteTarget;
    snapshot?: ClipboardSnapshot;
    clipboardReads?: Array<string | null>;
    snapshotError?: Error;
    tickMs?: number;
  }) {
    this.target = options.target ?? { id: "foreground-window" };
    this.snapshot = options.snapshot ?? { id: "snapshot", previousPlainText: "previous clipboard" };
    this.clipboardReads = [...(options.clipboardReads ?? [])];
    this.snapshotError = options.snapshotError;
    this.tickMs = options.tickMs ?? 25;
  }

  async captureForegroundTarget(): Promise<RewriteTarget> {
    this.calls.push("capture-target");
    return this.target;
  }

  async captureClipboardSnapshot(): Promise<ClipboardSnapshot> {
    this.calls.push("capture-snapshot");
    if (this.snapshotError !== undefined) {
      throw this.snapshotError;
    }

    return this.snapshot;
  }

  async sendCopy(): Promise<void> {
    this.calls.push("send-copy");
  }

  async readClipboardPlainText(): Promise<string | null> {
    this.calls.push("read-clipboard");
    this.currentTimeMs += this.tickMs;
    return this.clipboardReads.shift() ?? null;
  }

  async restoreClipboardSnapshot(): Promise<void> {
    this.calls.push("restore-snapshot");
  }

  async sleep(): Promise<void> {
    this.calls.push("sleep");
    this.currentTimeMs += this.tickMs;
  }

  now(): number {
    return this.currentTimeMs;
  }
}
