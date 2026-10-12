import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PluginConfig {
  controlPlaneUrl: string;
  apiKey: string | undefined;
  /** Absolute path of the shipit.key file the apiKey was read from, if any. */
  keyFile: string | undefined;
  requestTimeoutMs: number;
  maxReconnectAttempts: number;
  reconnectBaseDelayMs: number;
}

export const CONTROL_PLANE_ENV = "SHIPIT_CONTROL_PLANE_URL";
/**
 * @deprecated The SHIPIT_API_KEY token variable is no longer read. The bearer
 * token always comes from a shipit.key file next to an opencode.jsonc /
 * opencode.json file. Kept so existing imports do not break.
 */
export const API_KEY_ENV = "SHIPIT_API_KEY";
/** Explicit file-path override. This is a path, not a token. */
export const API_KEY_FILE = "SHIPIT_API_KEY_FILE";

/** File name looked up next to every opencode.jsonc / opencode.json. */
export const KEY_FILE_NAME = "shipit.key";

/** Directory of the global OpenCode config (opencode.jsonc lives here). */
export function globalConfigDir(): string {
  return path.join(os.homedir(), ".config", "opencode");
}

/**
 * Default key path — the shipit.key file in the same directory as the
 * OpenCode config. Prefers the nearest project config (walking up from cwd);
 * falls back to the global config dir. This is where login writes.
 */
export function defaultKeyPath(startDir?: string): string {
  const dirs = findOpencodeConfigDirs(startDir ?? safeCwd());
  if (dirs.length > 0) {
    return path.join(dirs[0], KEY_FILE_NAME);
  }
  return path.join(globalConfigDir(), KEY_FILE_NAME);
}

const DEFAULTS = {
  // Production control plane. Local development overrides with
  // SHIPIT_CONTROL_PLANE_URL=http://localhost:3000.
  controlPlaneUrl: "https://ship-it-fri1.onrender.com",
  requestTimeoutMs: 30_000,
  maxReconnectAttempts: 10,
  reconnectBaseDelayMs: 1_000,
};

/**
 * Overrides accepted from plugin options. The bearer token is deliberately
 * NOT overridable: apiKey/keyFile are excluded so no caller can substitute a
 * token for the one in shipit.key.
 */
export type ConfigOverrides = Partial<Omit<PluginConfig, "apiKey" | "keyFile">>;

/**
 * The bearer token ALWAYS comes from shipit.key — a file in the same
 * directory as an opencode.jsonc / opencode.json file: nearest project config
 * first (including its .opencode/ subdirectory variant), then the global
 * ~/.config/opencode/shipit.key. No plugin option, no SHIPIT_API_KEY
 * environment variable and no other source can override it.
 *
 * SHIPIT_API_KEY_FILE, when set, only chooses WHICH shipit.key path to read;
 * its contents must still look like a key (ox_live_/ox_test_ prefix), since a
 * pasted key with trailing whitespace or quotes would otherwise be sent as
 * garbage and 401.
 */
export function loadConfig(
  overrides: ConfigOverrides = {},
  opts: { cwd?: string } = {}
): PluginConfig {
  const controlPlaneUrl =
    overrides.controlPlaneUrl ??
    process.env[CONTROL_PLANE_ENV] ??
    DEFAULTS.controlPlaneUrl;

  const cwd = opts.cwd ?? safeCwd();
  const found = readKeyFileWithPath(cwd);

  return {
    controlPlaneUrl: controlPlaneUrl.replace(/\/+$/, ""),
    apiKey: found?.key,
    keyFile: found?.file,
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

function readKeyFile(startDir?: string): string | undefined {
  return readKeyFileWithPath(startDir)?.key;
}

/** Live bearer-token read: shipit.key fresh from disk (see readKeyFileWithPath). */
export function readBearerToken(startDir?: string): string | undefined {
  return readKeyFile(startDir);
}

/**
 * Same as readKeyFile but also reports which shipit.key file the key came
 * from. Reads the bearer token fresh from disk on every call so each request
 * carries the current file contents.
 */
export function readKeyFileWithPath(
  startDir?: string
): { key: string; file: string } | undefined {
  for (const candidate of keyFileCandidates(startDir ?? safeCwd())) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      const key = normalizeKey(fs.readFileSync(candidate, "utf8"));
      if (key) return { key, file: candidate };
    } catch {
      continue;
    }
  }

  return undefined;
}

/**
 * Ordered shipit.key candidates: explicit SHIPIT_API_KEY_FILE override first,
 * then one shipit.key per opencode config directory (nearest project first),
 * then the global config dir. Duplicates removed, order kept.
 */
export function keyFileCandidates(startDir: string): string[] {
  const candidates: string[] = [];
  const configured = process.env[API_KEY_FILE]?.trim();
  if (configured) {
    candidates.push(path.resolve(configured));
  }

  for (const dir of findOpencodeConfigDirs(startDir)) {
    candidates.push(path.join(dir, KEY_FILE_NAME));
  }

  // Project cwd lookups even when no opencode.jsonc/json exists yet there:
  // after `ensurePluginConfigured` creates the config, the key lands in one
  // of these same directories, so auth keeps working across that transition.
  candidates.push(path.join(startDir, KEY_FILE_NAME));
  candidates.push(path.join(startDir, ".opencode", KEY_FILE_NAME));

  const global = path.join(globalConfigDir(), KEY_FILE_NAME);
  candidates.push(global);
  // Previous global file name; still honoured for migration.
  candidates.push(path.join(globalConfigDir(), "shipit-key.txt"));

  return [...new Set(candidates)];
}

/**
 * Directories holding an opencode.jsonc or opencode.json, nearest first:
 * every ancestor of startDir (itself, then parents to the filesystem root),
 * each checked directly and via its .opencode/ subdirectory, plus the global
 * config dir last.
 */
export function findOpencodeConfigDirs(startDir: string): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();

  const pushIfConfig = (dir: string) => {
    const normalized = path.normalize(dir);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    if (isOpencodeConfigDir(dir)) {
      dirs.push(dir);
    }
  };

  let current: string | null = path.resolve(startDir);
  let guard = 0;
  while (current && guard++ < 100) {
    pushIfConfig(current);
    pushIfConfig(path.join(current, ".opencode"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  pushIfConfig(globalConfigDir());
  return dirs;
}

function isOpencodeConfigDir(dir: string): boolean {
  try {
    return (
      fs.existsSync(path.join(dir, "opencode.jsonc")) ||
      fs.existsSync(path.join(dir, "opencode.json"))
    );
  } catch {
    return false;
  }
}

function safeCwd(): string {
  try {
    return process.cwd();
  } catch {
    return globalConfigDir();
  }
}

export function resolveKeyFile(startDir?: string): string | undefined {
  return readKeyFileWithPath(startDir ?? safeCwd())?.file;
}

export function keySourcesTried(startDir?: string): string[] {
  return keyFileCandidates(startDir ?? safeCwd()).map((f) => `key file ${f}`);
}

export class MissingCredentialsError extends Error {
  constructor(startDir?: string) {
    super(
      `No Ship-It credentials found. Tried ${keySourcesTried(startDir).join(" and ")}. ` +
        `Run the shipit_login tool (or \`npx opencode-shipit-runtime login\`) to ` +
        `connect with a browser login — it writes shipit.key next to your ` +
        `opencode.jsonc/opencode.json.`
    );
    this.name = "MissingCredentialsError";
  }
}
