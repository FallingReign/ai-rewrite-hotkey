import type { SafeFailureCategory } from "./types.js";

export class RewriteSafeFailureError extends Error {
  readonly category: SafeFailureCategory;
  readonly httpStatus?: number;

  constructor(category: SafeFailureCategory, options: { httpStatus?: number } = {}) {
    super(category);
    this.name = "RewriteSafeFailureError";
    this.category = category;
    this.httpStatus = options.httpStatus;
  }
}

