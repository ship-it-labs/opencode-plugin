export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isQuotaError(): boolean {
    return this.code === "RUNTIME_QUOTA_EXCEEDED";
  }

  static from(status: number, body: unknown): ApiError {
    if (body && typeof body === "object" && "error" in body) {
      const parsed = body as ApiErrorBody;
      if (parsed.error && typeof parsed.error === "object") {
        return new ApiError(
          status,
          parsed.error.code ?? "UNKNOWN",
          parsed.error.message ?? "Request failed",
          parsed.error.details
        );
      }
    }
    return new ApiError(status, "UNKNOWN", `Request failed with status ${status}`);
  }
}

export class TransportError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TransportError";
    this.cause = cause;
  }
}
