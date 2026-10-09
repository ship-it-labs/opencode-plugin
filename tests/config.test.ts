import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { normalizeKey, loadConfig, API_KEY_ENV, API_KEY_FILE } from "../src/core/config/index.js";

describe("normalizeKey", () => {
  it("accepts clean keys", () => {
    expect(normalizeKey("ox_live_abc123")).toBe("ox_live_abc123");
    expect(normalizeKey("ox_test_abc123")).toBe("ox_test_abc123");
  });

  it("trims pasted whitespace and newlines", () => {
    expect(normalizeKey("  ox_live_abc123\n")).toBe("ox_live_abc123");
    expect(normalizeKey("ox_live_abc123\r\n")).toBe("ox_live_abc123");
  });

  it("strips launcher quotes", () => {
    expect(normalizeKey('"ox_live_abc123"')).toBe("ox_live_abc123");
    expect(normalizeKey("'ox_live_abc123'")).toBe("ox_live_abc123");
  });

  it("rejects empties, garbage and non-strings", () => {
    expect(normalizeKey("")).toBeUndefined();
    expect(normalizeKey("   ")).toBeUndefined();
    expect(normalizeKey("not-a-key")).toBeUndefined();
    expect(normalizeKey(undefined)).toBeUndefined();
    expect(normalizeKey(null)).toBeUndefined();
    expect(normalizeKey(42)).toBeUndefined();
  });
});

describe("loadConfig key fallthrough", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env[API_KEY_ENV];
    // Point the file lookup nowhere: the dev machine may hold a real key file,
    // which would otherwise satisfy the fallthrough under test.
    process.env[API_KEY_FILE] = "C:/nonexistent-shipit-test-dir/no-key-here.key";
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("prefers a dirty env var, cleaned, over the file", () => {
    process.env[API_KEY_ENV] = "  ox_live_fromenv\n";
    expect(loadConfig({}).apiKey).toBe("ox_live_fromenv");
  });

  it("falls through an empty env var instead of authenticating as nothing", () => {
    process.env[API_KEY_ENV] = "   ";
    // No key file present in test env: resolves undefined, not "".
    expect(loadConfig({}).apiKey).toBeUndefined();
  });

  it("falls through a garbage env var instead of 401ing on it", () => {
    process.env[API_KEY_ENV] = "definitely-not-a-key";
    expect(loadConfig({}).apiKey).toBeUndefined();
  });

  it("prefers an explicit override, cleaned", () => {
    process.env[API_KEY_ENV] = "ox_live_fromenv";
    expect(loadConfig({ apiKey: "ox_live_override  " }).apiKey).toBe(
      "ox_live_override"
    );
  });
});
