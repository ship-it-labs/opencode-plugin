export interface PluginConfig {
  controlPlaneUrl: string;
  apiKey: string | undefined;
  requestTimeoutMs: number;
  maxReconnectAttempts: number;
  reconnectBaseDelayMs: number;
}

export const CONTROL_PLANE_ENV = "SHIPIT_CONTROL_PLANE_URL";
export const API_KEY_ENV = "SHIPIT_API_KEY";

const DEFAULTS = {
  controlPlaneUrl: "http://localhost:3000",
  requestTimeoutMs: 30_000,
  maxReconnectAttempts: 10,
  reconnectBaseDelayMs: 1_000,
};

export function loadConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  const controlPlaneUrl =
    overrides.controlPlaneUrl ??
    process.env[CONTROL_PLANE_ENV] ??
    DEFAULTS.controlPlaneUrl;

  const apiKey = overrides.apiKey ?? process.env[API_KEY_ENV];

  return {
    controlPlaneUrl: controlPlaneUrl.replace(/\/+$/, ""),
    apiKey,
    requestTimeoutMs: overrides.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
    maxReconnectAttempts: overrides.maxReconnectAttempts ?? DEFAULTS.maxReconnectAttempts,
    reconnectBaseDelayMs: overrides.reconnectBaseDelayMs ?? DEFAULTS.reconnectBaseDelayMs,
  };
}

export class MissingCredentialsError extends Error {
  constructor() {
    super(
      `No Ship-It API key configured. Set ${API_KEY_ENV} (for example in opencode.json's "env" block) or pass plugin.apiKey.`
    );
    this.name = "MissingCredentialsError";
  }
}
