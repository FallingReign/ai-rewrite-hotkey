import type { RewriteHotkeyConfig } from "../config/types.js";

export const SCREENSHOT_CONTEXT_IMAGE_MAX_BYTES = 512 * 1024;

export type ScreenshotContextMediaType = "image/jpeg" | "image/png" | "image/webp";
export type ScreenshotPayloadSizeClass = "none" | "small" | "medium" | "large" | "too_large";
export type ScreenshotContextDegradationCategory =
  | "screenshot_capture_failed"
  | "screenshot_processing_failed"
  | "screenshot_payload_too_large"
  | "vision_unsupported";

export interface ScreenshotContextImage {
  mediaType: ScreenshotContextMediaType;
  base64: string;
  byteLength: number;
  width?: number;
  height?: number;
}

export type ScreenshotContextInput =
  | ({
      ok: true;
    } & ScreenshotContextImage)
  | {
      ok: false;
      category?: ScreenshotContextDegradationCategory;
    };

export interface ScreenshotContextMetadata {
  screenshotContextEnabled: boolean;
  screenshotContextCaptured: boolean;
  screenshotContextIncluded: boolean;
  screenshotContextDegraded: boolean;
  screenshotContextDegradationCategory?: ScreenshotContextDegradationCategory;
  screenshotPayloadSizeClass: ScreenshotPayloadSizeClass;
}

export type ScreenshotContextResolution =
  | {
      status: "disabled" | "unavailable";
      metadata: ScreenshotContextMetadata;
    }
  | {
      status: "available";
      image: ScreenshotContextImage;
      metadata: ScreenshotContextMetadata;
    }
  | {
      status: "degraded";
      category: ScreenshotContextDegradationCategory;
      metadata: ScreenshotContextMetadata;
    };

export type ScreenshotContextCapture = () => Promise<ScreenshotContextInput>;

export async function captureScreenshotContext(
  config: RewriteHotkeyConfig,
  capture: ScreenshotContextCapture | undefined
): Promise<ScreenshotContextResolution> {
  if (!config.screenshotContextEnabled) {
    return disabledScreenshotContext();
  }

  if (capture === undefined) {
    return unavailableScreenshotContext();
  }

  try {
    return resolveScreenshotContext(config, await capture());
  } catch {
    return degradedScreenshotContext("screenshot_capture_failed", false, "none");
  }
}

export function resolveScreenshotContext(
  config: RewriteHotkeyConfig,
  input: ScreenshotContextInput | undefined
): ScreenshotContextResolution {
  if (!config.screenshotContextEnabled) {
    return disabledScreenshotContext();
  }

  if (input === undefined) {
    return unavailableScreenshotContext();
  }

  if (!input.ok) {
    return degradedScreenshotContext(input.category ?? "screenshot_capture_failed", false, "none");
  }

  if (!isSupportedMediaType(input.mediaType) || !isValidBase64(input.base64) || input.byteLength <= 0) {
    return degradedScreenshotContext("screenshot_processing_failed", true, "none");
  }

  const payloadSizeClass = classifyScreenshotPayloadSize(input.byteLength);
  if (payloadSizeClass === "too_large") {
    return degradedScreenshotContext("screenshot_payload_too_large", true, payloadSizeClass);
  }

  return {
    status: "available",
    image: {
      mediaType: input.mediaType,
      base64: input.base64,
      byteLength: input.byteLength,
      width: finitePositiveInteger(input.width),
      height: finitePositiveInteger(input.height)
    },
    metadata: {
      screenshotContextEnabled: true,
      screenshotContextCaptured: true,
      screenshotContextIncluded: false,
      screenshotContextDegraded: false,
      screenshotPayloadSizeClass: payloadSizeClass
    }
  };
}

export function withIncludedScreenshotContext(metadata: ScreenshotContextMetadata): ScreenshotContextMetadata {
  return {
    ...metadata,
    screenshotContextIncluded: true,
    screenshotContextDegraded: false,
    screenshotContextDegradationCategory: undefined
  };
}

export function withDegradedScreenshotContext(
  metadata: ScreenshotContextMetadata,
  category: ScreenshotContextDegradationCategory
): ScreenshotContextMetadata {
  return {
    ...metadata,
    screenshotContextIncluded: false,
    screenshotContextDegraded: true,
    screenshotContextDegradationCategory: category
  };
}

export function classifyScreenshotPayloadSize(byteLength: number): ScreenshotPayloadSizeClass {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return "none";
  }

  if (byteLength > SCREENSHOT_CONTEXT_IMAGE_MAX_BYTES) {
    return "too_large";
  }

  if (byteLength <= 128 * 1024) {
    return "small";
  }

  if (byteLength <= 384 * 1024) {
    return "medium";
  }

  return "large";
}

export function screenshotContextDataUrl(image: ScreenshotContextImage): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}

function disabledScreenshotContext(): ScreenshotContextResolution {
  return {
    status: "disabled",
    metadata: {
      screenshotContextEnabled: false,
      screenshotContextCaptured: false,
      screenshotContextIncluded: false,
      screenshotContextDegraded: false,
      screenshotPayloadSizeClass: "none"
    }
  };
}

function unavailableScreenshotContext(): ScreenshotContextResolution {
  return {
    status: "unavailable",
    metadata: {
      screenshotContextEnabled: true,
      screenshotContextCaptured: false,
      screenshotContextIncluded: false,
      screenshotContextDegraded: false,
      screenshotPayloadSizeClass: "none"
    }
  };
}

function degradedScreenshotContext(
  category: ScreenshotContextDegradationCategory,
  captured: boolean,
  payloadSizeClass: ScreenshotPayloadSizeClass
): ScreenshotContextResolution {
  return {
    status: "degraded",
    category,
    metadata: {
      screenshotContextEnabled: true,
      screenshotContextCaptured: captured,
      screenshotContextIncluded: false,
      screenshotContextDegraded: true,
      screenshotContextDegradationCategory: category,
      screenshotPayloadSizeClass: payloadSizeClass
    }
  };
}

function isSupportedMediaType(value: string): value is ScreenshotContextMediaType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function isValidBase64(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value) && value.length % 4 === 0;
}

function finitePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
