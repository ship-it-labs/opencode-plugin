import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PluginConfig {
  controlPlaneUrl: string;
  apiKey: string | undefined;
  requestTimeoutMs: number;
  maxReconnectAttempts: number;
  reconnectBaseDelayMs: number;
}

export const CONTROL_PLANE_ENV = "SHIPIT_CONTROL_PLANE_URL";
export const API_KEY_ENV = "SHIPIT_API_KEY";
export const API_KEY_FILE = "SHIPIT_API_KEY_FILE";

const DEFAULTS = {
  // Production control plane. Local development overrides with
  // SHIPIT_CONTROL_PLANE_URL=http://localhost:3000.
  controlPlaneUrl: "https://ship-it-fri1.onrender.com",
  requestTimeoutMs: 30_000,
  maxReconnectAttempts: 10,
  reconnectBaseDelayMs: 1_000,
};

/**
 * Where the account key is read from, in order:
 *
 * 1. An explicit override, e.g. from plugin options.
 * 2. The SHIPIT_API_KEY environment variable.
 * 3. A key file: SHIPIT_API_KEY_FILE, or ~/.config/opencode/shipit.key by
 *    default. This is the most reliable option on machines where the launcher
 *    does not forward custom environment variables to plugins.
 *
 * Every source is trimmed and must look like a key (ox_live_/ox_test_
 * prefix). A pasted key with trailing whitespace or quotes, or an empty
 * variable shadowing the file, falls through to the next source instead of
 * authenticating as garbage and 401ing with "valid" credentials.
 */
export function loadConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  const controlPlaneUrl =
    overrides.controlPlaneUrl ??
    process.env[CONTROL_PLANE_ENV] ??
    DEFAULTS.controlPlaneUrl;

  const apiKey =
    normalizeKey(overrides.apiKey) ??
    normalizeKey(process.env[API_KEY_ENV]) ??
    readKeyFile();

  return {
    controlPlaneUrl: controlPlaneUrl.replace(/\/+$/, ""),
    apiKey,
    requestTimeoutMs: overrides.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
    maxReconnectAttempts: overrides.maxReconnectAttempts ?? DEFAULTS.maxReconnectAttempts,
    reconnectBaseDelayMs: overrides.reconnectBaseDelayMs ?? DEFAULTS.reconnectBaseDelayMs,
  };
}

/** Trims pasted keys and rejects anything that cannot be an account key. */
export function normalizeKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Strip surrounding whitespace and the quotes launchers and .env files
  // love to leave behind.
  const key = value.trim().replace(/^["']|["']$/g, "").trim();
  if (key.startsWith("ox_live_") || key.startsWith("ox_test_")) {
    return key;
  }
  return undefined;
}

function readKeyFile(): string | undefined {
  const configured = process.env[API_KEY_FILE];
  const candidates = configured
    ? [configured]
    : [
        path.join(os.homedir(), ".config", "opencode", "shipit.key"),
        path.join(os.homedir(), ".config", "opencode", "shipit-key.txt"),
      ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const key = normalizeKey(fs.readFileSync(candidate, "utf8"));
      if (key) return key;
    } catch {
      continue;
    }
  }

  return undefined;
}

export function keySourcesTried(): string[] {
  const file = process.env[API_KEY_FILE] ?? path.join(os.homedir(), ".config", "opencode", "shipit.key");
  return [`environment variable ${API_KEY_ENV}`, `key file ${file}`];
}

export class MissingCredentialsError extends Error {
  constructor() {
    super(
      `No Ship-It API key found. Tried ${keySourcesTried().join(" and ")}. ` +
        `Create a key in the dashboard, then either set ${API_KEY_ENV} in the ` +
        `environment OpenCode starts with, or write the key to the key file.`
    );
    this.name = "MissingCredentialsError";
  }
}
