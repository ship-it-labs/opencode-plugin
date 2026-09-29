import { ApiClient } from "../api/client.js";
import { loadConfig, MissingCredentialsError, PluginConfig } from "../config/index.js";
import { SessionState } from "../state/session.js";

export class AuthContext {
  private readonly config: PluginConfig;
  private readonly client: ApiClient;
  private credentialsError: MissingCredentialsError | null = null;

  constructor(config: PluginConfig, state: SessionState) {
    this.config = config;
    this.client = new ApiClient(config.controlPlaneUrl, () => this.requireKey(), config.requestTimeoutMs);
    state.setClient(this.client);
  }

  private requireKey(): string {
    if (!this.config.apiKey) {
      if (!this.credentialsError) {
        this.credentialsError = new MissingCredentialsError();
      }
      throw this.credentialsError;
    }
    return this.config.apiKey;
  }

  get apiClient(): ApiClient {
    this.requireKey();
    return this.client;
  }

  get isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  get controlPlaneUrl(): string {
    return this.config.controlPlaneUrl;
  }

  async verify(): Promise<{ valid: boolean; plan?: string; userId?: string }> {
    const usage = await this.apiClient.get<{ plan: { name: string } }>("/api/v1/usage");
    return { valid: true, plan: usage.plan.name };
  }
}
