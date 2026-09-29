import { ApiError, TransportError } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

export class ApiClient {
  private readonly baseUrl: string;
  private apiKeyProvider: () => string;
  private readonly defaultTimeoutMs: number;

  constructor(
    baseUrl: string,
    apiKeyProvider: () => string,
    defaultTimeoutMs = 30_000
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKeyProvider = apiKeyProvider;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKeyProvider()}`,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? `Request to ${url.pathname} timed out after ${timeoutMs}ms`
          : `Could not reach control plane at ${this.baseUrl}. Check that it is running and reachable.`;
      throw new TransportError(message, err);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const body = text ? safeParse(text) : null;

    if (!response.ok) {
      throw ApiError.from(response.status, body);
    }

    return body as T;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  async upload<T>(path: string, form: FormData, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    const timeoutMs = options.timeoutMs ?? 300_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKeyProvider()}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? `Upload to ${url.pathname} timed out after ${timeoutMs}ms`
          : `Could not reach control plane at ${this.baseUrl} while uploading.`;
      throw new TransportError(message, err);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const body = text ? safeParse(text) : null;

    if (!response.ok) {
      throw ApiError.from(response.status, body);
    }

    return body as T;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
