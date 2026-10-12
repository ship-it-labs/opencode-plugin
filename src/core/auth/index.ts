import { ApiClient } from "../api/client.js";
import {
  MissingCredentialsError,
  type PluginConfig,
  readKeyFileWithPath,
} from "../config/index.js";
import { SessionState } from "../state/session.js";

export class AuthContext {
  private readonly config: PluginConfig;
  private readonly client: ApiClient;
  private credentialsError: MissingCredentialsError | null = null;

  constructor(config: PluginConfig, state: SessionState) {
    this.config = config;
    // The bearer token always comes from shipit.key, read live on every
    // request, so the file stays the single source of truth (login without
    // restart, key rotation, multi-project). Nothing can override it.
    this.client = new ApiClient(config.controlPlaneUrl, () => this.requireKey(), config.requestTimeoutMs);
    state.setClient(this.client);
  }

  /** Bearer token for the Authorization header: shipit.key, read fresh. */
  private requireKey(): string {
    const found = readKeyFileWithPath();
    if (found) return found.key;
    // Fall back to the startup snapshot (covers exotic setups where cwd at
    // request time differs from cwd at load time).
    if (this.config.apiKey) return this.config.apiKey;
    if (!this.credentialsError) {
      this.credentialsError = new MissingCredentialsError();
    }
    throw this.credentialsError;
  }

  /** Current bearer token without throwing, for websocket connect. */
  currentKey(): string | undefined {
    return readKeyFileWithPath()?.key ?? this.config.apiKey;
  }

  get keyFile(): string | undefined {
    return readKeyFileWithPath()?.file ?? this.config.keyFile;
  }

  get apiClient(): ApiClient {
    this.requireKey();
    return this.client;
  }

  get isConfigured(): boolean {
    return Boolean(this.currentKey());
  }

  get controlPlaneUrl(): string {
    return this.config.controlPlaneUrl;
  }

  async verify(): Promise<{ valid: boolean; plan?: string; userId?: string }> {
    const usage = await this.apiClient.get<{ plan: { name: string } }>("/api/v1/usage");
    return { valid: true, plan: usage.plan.name };
  }
}
